const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const Question = require('./question');
const promisify = require('./promisify');

const CONFIG_FILE = __dirname + '/../../config.json';
const UPLOAD_PATH = __dirname + '/../upload/';
const VERIFIED_PATH = __dirname + '/../verified/';
const REJECTED_PATH = __dirname + '/../rejected/';

const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';
const REGEX_FREETEXT = '<FreeText>(.*?)<\/FreeText>';
const REGEX_QUESTION = '<QuestionIdentifier>(.*?)<\/QuestionIdentifier>';

const DEFAULT_FEEDBACK = "Thanks for the great work!";

const COMMANDS = {
  'help': 'Display this help text.',
  'list': 'List the current HITs and their status.',
  'add': 'Add a new voice recording HIT.',
  'review': 'Review current HITs',
  'approve': 'Approve HITs.',
  'reset': ' Reset reviewing status back to available.',
  'trim': 'Delete all deletable jobs.'
};

function little(str) {
  return str.substr(0, 4) + str.substr(-4);
}

function MechTurk() {
  AWS.config.loadFromPath(CONFIG_FILE);
  this._mt = new AWS.MTurk({ endpoint: ENDPOINT });
  this._question = new Question(this._mt);
}

MechTurk.prototype._glob = function(pattern) {
  return promisify(null, glob, pattern);
};

MechTurk.prototype._deleteHIT = function(HITId) {
  return promisify(this._mt, this._mt.deleteHIT, { HITId: HITId });
};


MechTurk.prototype._listAssignmentsForHIT = function(options) {
  options.MaxResults = options.MaxResults || 100;
  options.AssignmentStatuses = ['Submitted'];
  return promisify(this._mt, this._mt.listAssignmentsForHIT, options);
};

MechTurk.prototype._listHITs = function(NextToken) {
  var options = {};
  if (NextToken) {
    options.NextToken = NextToken;
  }
  return promisify(this._mt, this._mt.listHITs, options);
};

MechTurk.prototype._listReviewableHITs = function(NextToken) {
  var options = {};
  if (NextToken) {
    options.NextToken = NextToken;
  }
  return promisify(this._mt, this._mt.listReviewableHITs, options);
};

MechTurk.prototype._updatHITReviewStatus = function(id, Revert) {
  // Default to setting hit to Reviewing.
  Revert = typeof Revert === 'undefined' ? false : Revert;
  return promisify(this._mt, this._mt.updateHITReviewStatus, {
    HITId: id,
    Revert: Revert
  });
};

MechTurk.prototype._deleteHIT = function(id) {
  return promisify(this._mt, this._mt.deleteHIT, {
    HITId: id,
  });
};

MechTurk.prototype._expireHIT = function(id) {
  return promisify(this._mt, this._mt.updateExpirationForHIT, {
    HITId: id,
    ExpireAt: 0
  });
};

MechTurk.prototype._approveAssignment = function(id) {
  return promisify(this._mt, this._mt.approveAssignment, {
    AssignmentId: id,
    RequesterFeedback: DEFAULT_FEEDBACK
  });
};

MechTurk.prototype._getSentenceFromAnswer = function(Answer) {
  // We assume the only FreeText in the answer XML is the excerpt.
  return RegExp(REGEX_FREETEXT).exec(Answer)[1];
};

MechTurk.prototype._getInfoFromVerify = function(Answer) {
  var answer = {};
  var reFree = new RegExp(REGEX_FREETEXT, 'g');
  var reQuestion = new RegExp(REGEX_QUESTION, 'g');

  var matchFree = reFree.exec(Answer);
  var matchQuestion = reQuestion.exec(Answer);
  while (matchFree && matchQuestion) {
    answer[matchQuestion[1]] = matchFree[1];
    matchFree = reFree.exec(Answer);
    matchQuestion = reQuestion.exec(Answer);
  }

  return answer;
};

MechTurk.prototype._getAssigments = function(NextToken) {
  var assignments = [];
  var results = null;

  return this._listReviewableHITs(NextToken)
    .then(r => {
      results = r;
      var hits = results.HITs.map(hit => {
        return {
          HITId: hit.HITId
        };
      });
      return promisify.map(this, this._listAssignmentsForHIT, hits);
    })

    .then(r => {
      r.forEach(hit => {
        assignments = assignments.concat(hit.Assignments);
      });

      return {
        assignments: assignments,
        NextToken: results.NextToken
      };
    });
};
MechTurk.prototype._runOnAllHits = function(method, NextToken) {
  return this._listHITs(NextToken)
    .then(results => {
      var hits = results.HITs;
      var next = results.NextToken;

      return promisify.map(this, method, hits)
        .then(results => {
          if (!next) {
            return hits.length;
          }

          return this._runOnAllHits(method, next).then(r => {
            return hits.length + r;
          });
        });
    });
};

MechTurk.prototype._reviewAll = function(recordType, verifyType, NextToken) {
  return Promise.all([
    recordType || this._question.getRecordHitType(),
    verifyType || this._question.getVerifyHitType(),
    this._listHITs(NextToken)
  ])

  .then(results => {
    recordType = results[0];
    verifyType = results[1];
    var hitResults = results[2];

    var next = hitResults.NextToken;
    var hits = hitResults.HITs.filter(hit => {
      return hit.HITStatus === 'Reviewable';
    });

    return this._processHits(hits, recordType, verifyType)
      .then((results) => {
        if (next) {
          return this._reviewAll(recordType, verifyType, next);
         }
      });
  });
};

MechTurk.prototype._processRecord = function(HITId, assignments) {
  var params = assignments.map(a => {
    return {
      HITId: HITId,
      AssignmentId: a.AssignmentId,
      WorkerId: a.WorkerId,
      excerpt: this._getSentenceFromAnswer(a.Answer)
    };
  });

  return promisify.map(this._question, this._question.addVerify, params)
    .then(results => {
      return results.length;
    });
};

MechTurk.prototype._processVerify = function(assignments) {
  var answers = assignments.map(assignment => {
    return {
      HITId: assignment.HITId,
      id: assignment.AssignmentId,
      answer: this._getInfoFromVerify(assignment.Answer)
    };
  });

  return promisify.map(this, results => {
    var AssignmentId = results.id;
    var answer = results.answer;
    var pattern = path.resolve(UPLOAD_PATH, answer.previousworkerid,
                               answer.previousassignmentid + '.*');
    return this._glob(pattern)

    .then(files => {
      if (!files || files.length === 0) {
        console.log('unable to get files', pattern);
        throw 'No uploaded files found';
      }

      var destination;
      if (answer.answer === 'yes') {
        destination = path.resolve(VERIFIED_PATH, answer.previousworkerid);
      } else if (answer.answer === 'no' || answer.answer === 'bad') {
        destination = path.resolve(REJECTED_PATH, answer.previousworkerid);
      } else {
        console.error('unrecognized answer', answer.answer);
        throw 'Unrecognized verify answer: ' + answer.answers;
      }

      return promisify.map(this, f => {
        var p = path.resolve(destination, path.basename(f));
        return promisify(fs, fs.move, [f, p]);
      }, files)

      .then(() => {
        if (answer.answer === 'yes') {
          console.log('voice clip accepted', little(results.HITId));
        } else {
          console.log('sound rejected', little(results.HITId));
        }

        return this._approveAssignment(AssignmentId);
      });
    });
  }, answers)

  .then(results => {
    return results.length;
  });
};

MechTurk.prototype._approveAssignmentsForHit = function(HITId, NextToken) {
  var count = 0;
  var next;

  return this._listAssignmentsForHIT({
    HITId: HITId,
    NextToken: NextToken
  })

  .then(results => {
    next = results.NextToken;
    var assignments = results.Assignments.map(a => {
      return a.AssignmentId;
    });
    return promisify.map(this, this._approveAssignment, assignments);
  })

  .then(results => {
    count += results.length;
    if (next) {
      return this._approveAssignmentsForHit(HITId, next);
    }
  })

  .then(results => {
    return count + (results || 0);
  });
};

MechTurk.prototype._finalizeVerify = function(verifyId, recordId) {
  return Promise.all([
      this._deleteHIT(verifyId),
      this._approveAssignmentsForHit(recordId)
  ])

  .then(() => {
    return this._deleteHIT(recordId);
  });
};

MechTurk.prototype._processHits = function(hits, recordType, verifyType) {
  return promisify.map(this, hit => {
    var HITId = hit.HITId;
    var HITTypeId = hit.HITTypeId;
    var count = 0;

    // We need createVerifyHITs as an entrypoint for psuedo recursion.
    // This will process all assignments for hit.
    return (function createVerifyHITs(NextToken) {
      var results;

      return this._listAssignmentsForHIT({
        HITId: HITId,
        NextToken: NextToken
      })

      .then(r => {
        results = r;
        if (HITTypeId === recordType) {
          return this._processRecord(HITId, results.Assignments);
        } else if (HITTypeId === verifyType) {
          return this._processVerify(results.Assignments);
        } else {
          console.error('Unrecognized hit type', hit);
          throw 'Unrecognized hit: ' + little(hit.HITId);
        }
      })

      .then(results => {
        count += results;
        if (results.NextToken) {
          return createVerifyHITs.call(this, results.NextToken);
        }
      })

      .then(results => {
        return count + (results || 0);
      });
    }).call(this)

    .then(results => {
      if (HITTypeId === recordType) {
        return this._updatHITReviewStatus(HITId, false);
      } else if (HITTypeId === verifyType) {
        return this._finalizeVerify(HITId, hit.RequesterAnnotation);
      }
    });
  }, hits);
};

MechTurk.prototype._approveAll = function(NextToken) {
  return this._getAssigments(NextToken)
    .then(data => {
      var assignments = data.assignments;
      var next = data.NextToken;

      return promisify.map(this, this._approveAssignment, assignments.map(a => {
        return a.AssignmentId;
      }))

      .then(() => {
        if (!next) {
          return assignments.length;
        }

        return this._approveAll(next).then(r => {
          return assignments.length + r;
        });
      });
    });
};

MechTurk.prototype.approve = function() {
  return this._approveAll()
    .then(approved => {
      console.log(`approved ${approved} assignments`);
    });
};

MechTurk.prototype.review = function() {
  return this._reviewAll();
};

MechTurk.prototype.reset = function() {
  var count = 0;
  return this._runOnAllHits(hit => {
    if (hit.HITStatus === 'Reviewing') {
      ++count;
      return this._updatHITReviewStatus(hit.HITId, true);
    }
  }).then(results => {
    console.log(`reset ${count} out of ${results} HITs`);
  });
};


MechTurk.prototype._deleteReviewable = function(NextToken) {
  var deleted = 0;
  var next;

  return this._listHITs(NextToken)
    .then(hits => {
      next = hits.NextToken;

      return promisify.map(this, hit => {
        if (hit.HITStatus !== 'Reviewable') {
          return;
        }

        return this._deleteHIT(hit.HITId).then(() => {
          ++deleted;
        }).catch(e => {
          console.error('del error', e.message);
        });
      }, hits.HITs);
  })

  .then(() => {
    if (next) {
      return this._deleteReviewable(next);
    }
  })

  .then(r => {
    return deleted;
  });
};

MechTurk.prototype.trim = function() {
  return this._deleteReviewable()
    .then(results => {
      console.log('deleted jobs', results);
    });
};

MechTurk.prototype._listAll = function(recordType, verifyType, NextToken) {
  var count = 0;

  return this._listHITs(NextToken).then(hits => {
    hits.HITs.forEach(hit => {
      var type = 'Unrecognized';
      if (hit.HITTypeId === recordType) {
        type = 'Recording';
      } else if (hit.HITTypeId === verifyType) {
        type = 'Verifying';
      }

      var pending = hit.NumberOfAssignmentsPending;
      var available = hit.NumberOfAssignmentsAvailable;
      var completed = hit.NumberOfAssignmentsCompleted;
      console.log(little(hit.HITId), type, hit.HITStatus,
                  pending, 'pending',
                  available, 'available',
                  completed, 'completed');
      ++count;
    });

    if (hits.NextToken) {
      return this._listAll(recordType, verifyType, hits.NextToken);
    }
  })

  .then(results => {
    return count + (results || 0);
  });
};

MechTurk.prototype.list = function() {
  return Promise.all([
    this._question.getRecordHitType(),
    this._question.getVerifyHitType()
  ])

  .then(results => {
    var recordType = results[0];
    var verifyType = results[1];
    return this._listAll(recordType, verifyType);
  })

  .then(count => {
    if (count === 0) {
      console.log('no current hits');
    }
  });
};

MechTurk.prototype.add = function(count) {
  return this._question.add();
};

MechTurk.prototype.help = function() {
  console.log('\nUsage: `gulp turk --command`');
  Object.keys(COMMANDS).forEach(command => {
    console.log(`  --${command} - ${COMMANDS[command]}`);
  });
  console.log();
};

MechTurk.prototype.runCommand = function(command, parameter) {
  if (!COMMANDS[command]) {
    console.log('Unrecognized command', command);
    this.help();
    return;
  }

  if (typeof this[command] !== 'function') {
    console.error('Error, undefined function for command', command);
    return;
  }

  return this[command](parameter);
};

module.exports = new MechTurk();
