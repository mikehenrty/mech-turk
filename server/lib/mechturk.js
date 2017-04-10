'use strict';

const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs-extra');
const glob = require('glob');
const Question = require('./question');
const promisify = require('./promisify');

const CONFIG_FILE = __dirname + '/../../config.json';
const UPLOAD_PATH = __dirname + '/../upload/';
const RECORDED_DIR = 'recorded';
const RECORDED_PATH = path.resolve(UPLOAD_PATH, RECORDED_DIR);
const VERIFIED_DIR = 'verified';
const VERIFIED_PATH = path.resolve(UPLOAD_PATH, VERIFIED_DIR);
const REJECTED_DIR = 'rejected';
const REJECTED_PATH = path.resolve(UPLOAD_PATH, REJECTED_DIR);

const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';
const REGEX_FREETEXT = '<FreeText>(.*?)<\/FreeText>';
const REGEX_QUESTION = '<QuestionIdentifier>(.*?)<\/QuestionIdentifier>';

const DEFAULT_FEEDBACK = "Thanks for the great work!";

const COMMANDS = {
  'help'   : 'Display this help text.',
  'list'   : 'List the current HITs and their status.',
  'stats'  : 'List the status of the current uploaded clips.',
  'add'    : 'Add a new voice recording HIT.',
  'review' : 'Review current HITs',
  'approve': 'Approve HITs.',
  'reset'  : 'Reset reviewing status back to available.',
  'trim'   : 'Delete all deletable jobs.'
};

function printStack() {
  console.log((new Error().stack));
}

function countResults(results) {
  if (typeof results === 'number') {
    return results;
  }
  if (Array.isArray(results)) {
    return results.reduce((acc, result) => {
      return acc + result;
    }, 0);
  }

  console.error('could not count unrecognized results', results);
}

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
  let options = {};
  if (NextToken) {
    options.NextToken = NextToken;
  }
  return promisify(this._mt, this._mt.listHITs, options);
};

MechTurk.prototype._listReviewableHITs = function(NextToken) {
  let options = {};
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
  let answer = {};
  let reFree = new RegExp(REGEX_FREETEXT, 'g');
  let reQuestion = new RegExp(REGEX_QUESTION, 'g');

  let matchFree = reFree.exec(Answer);
  let matchQuestion = reQuestion.exec(Answer);
  while (matchFree && matchQuestion) {
    answer[matchQuestion[1]] = matchFree[1];
    matchFree = reFree.exec(Answer);
    matchQuestion = reQuestion.exec(Answer);
  }

  return answer;
};

MechTurk.prototype._getAssigments = function(NextToken) {
  let assignments = [];
  let results = null;

  return this._listReviewableHITs(NextToken)
    .then(r => {
      results = r;
      let hits = results.HITs.map(hit => {
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
      let hits = results.HITs;
      let next = results.NextToken;

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
    let hitResults = results[2];

    let next = hitResults.NextToken;
    let hits = hitResults.HITs.filter(hit => {
      return hit.HITStatus === 'Reviewable';
    });

    return this._processHits(hits, recordType, verifyType)
      .then((results) => {
        if (next) {
          return this._reviewAll(recordType, verifyType, next)
            .then(r => {
              return countResults(results) + countResults(r);
            });
         }

        return countResults(results);
      });
  });
};

MechTurk.prototype._processRecord = function(HITId, assignments) {
  let params = assignments.map(a => {
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
  let answers = assignments.map(assignment => {
    return {
      HITId: assignment.HITId,
      id: assignment.AssignmentId,
      answer: this._getInfoFromVerify(assignment.Answer)
    };
  });

  return promisify.map(this, results => {
    let AssignmentId = results.id;
    let answer = results.answer;
    let pattern = path.resolve(RECORDED_PATH, answer.previousworkerid,
                               answer.previousassignmentid + '.*');
    return this._glob(pattern)

    .then(files => {
      let destination;
      files = files || [];
      if (answer.answer === 'yes') {
        destination = path.resolve(VERIFIED_PATH, answer.previousworkerid);
      } else if (answer.answer === 'no' || answer.answer === 'bad') {
        destination = path.resolve(REJECTED_PATH, answer.previousworkerid);
      } else {
        console.error('unrecognized answer', answer.answer);
        throw 'Unrecognized verify answer: ' + answer.answers;
      }

      return promisify.map(this, f => {
        let p = path.resolve(destination, path.basename(f));
        return promisify(fs, fs.move, [f, p]);
      }, files)

      .then(r => {
        if (files.length === 0) {
          console.log('voice clip no found, discarded', little(results.HITId));
        } else if (answer.answer === 'yes') {
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
  let count = 0;
  let next;

  return this._listAssignmentsForHIT({
    HITId: HITId,
    NextToken: NextToken
  })

  .then(results => {
    next = results.NextToken;
    let assignments = results.Assignments.map(a => {
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
    let HITId = hit.HITId;
    let HITTypeId = hit.HITTypeId;
    let count = 0;

    // We need createVerifyHITs as an entrypoint for psuedo recursion.
    // This will process all assignments for hit.
    return (function createVerifyHITs(NextToken) {
      let results;

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

    .then(processed => {
      if (processed < 1) {
        return processed;
      }

      if (HITTypeId === recordType) {
        return this._updatHITReviewStatus(HITId, false).then(t=> {
          return processed;
        });
      } else if (HITTypeId === verifyType) {
        return this._finalizeVerify(HITId, hit.RequesterAnnotation)
          .then(t=> {
            return processed;
          });
      }
    });
  }, hits);
};

MechTurk.prototype._approveAll = function(NextToken) {
  return this._getAssigments(NextToken)
    .then(data => {
      let assignments = data.assignments;
      let next = data.NextToken;

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
  return this._reviewAll().then(reviewed => {
    if (reviewed < 1) {
      console.log('no reviewable jobs');
    }
  });
};

MechTurk.prototype.reset = function() {
  let count = 0;
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
  let deleted = 0;
  let next;

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
  let count = 0;

  return this._listHITs(NextToken).then(hits => {
    hits.HITs.forEach(hit => {
      let type = 'Unrecognized';
      if (hit.HITTypeId === recordType) {
        type = 'Recording';
      } else if (hit.HITTypeId === verifyType) {
        type = 'Verifying';
      }

      let pending = hit.NumberOfAssignmentsPending;
      let available = hit.NumberOfAssignmentsAvailable;
      let completed = hit.NumberOfAssignmentsCompleted;
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
    let recordType = results[0];
    let verifyType = results[1];
    return this._listAll(recordType, verifyType);
  })

  .then(count => {
    if (count === 0) {
      console.log('no current hits');
    }
  });
};

MechTurk.prototype.add = function(count) {
  // Default to add 1 record HIT.
  count = typeof count === 'undefined' ? 1 : count;
  let promises = [];
  for (let i = 0; i < count; i++) {
    promises.push(this._question.add());
  }
  return Promise.all(promises)
    .then(results => {

      // Print nice output for adding all these jobs.
      // Print any new group urls, and new job count.
      let count = results.length;
      Object.keys(results.reduce((acc, val) => {
        acc[val] = true;
        return acc;
      }, {})).forEach(url => {
        console.log(url);
      });
      console.log('new jobs created', count);
    });
};

MechTurk.prototype.help = function() {
  console.log('\nUsage: `gulp turk --command`');
  Object.keys(COMMANDS).forEach(command => {
    console.log(`  --${command} - ${COMMANDS[command]}`);
  });
  console.log();
};

MechTurk.prototype.stats = function() {
  let rec = 0;
  let ver = 0;
  let rej = 0;

  return new Promise((resolve, reject) => {
    let walk = require('walk');
    let walker = walk.walk(UPLOAD_PATH);

    walker.on('file', (root, fileStats, next) => {
      if (fileStats.name === 'README.txt') {
        next();
        return;
      }

      if (fileStats.name.substr(-4) !== '.txt') {
        next();
        return;
      }

      if (root.indexOf(RECORDED_DIR) !== -1) {
        ++rec;
      } else if (root.indexOf(VERIFIED_DIR) !== -1) {
        ++ver;
      } else if (root.indexOf(REJECTED_DIR) !== -1) {
        ++rej;
      } else {
        console.error('unrecognized text file', root, fileStats.name);
      }
      next();
    });

    walker.on('end', () => {
      console.log(`${rec} unverified, ${ver} verified, ${rej} rejected`);
      resolve();
    });

  });
};

MechTurk.prototype.runCommand = function(command, parameter) {
  if (!COMMANDS[command]) {
    console.log('Unrecognized command', command);
    this.help();
    return Promise.resolve();
  }

  if (typeof this[command] !== 'function') {
    console.error('Error, undefined function for command', command);
    return Promise.reject('unrec command:' + command);
  }

  /*
  // Debug output for funning server commands.
  // Runs prints list before and after command.
  if (command !== 'list' && command !== 'stats') {
    return this.list().then(results => {
      return this[command](parameter);
    }).then(results => {
      return this.list();
    });
  }
  */

  return this[command](parameter);
};

module.exports = new MechTurk();
