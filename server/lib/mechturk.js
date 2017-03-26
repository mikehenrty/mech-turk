const AWS = require('aws-sdk');
const Question = require('./question');
const promisify = require('./promisify');

const CONFIG_FILE = __dirname + '/../../config.json';
const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';

const DEFAULT_FEEDBACK = "Thanks for the great work!";

function little(str) {
  return str.substr(0, 5) + str.substr(-5);
}

function MechTurk() {
  AWS.config.loadFromPath(CONFIG_FILE);
  this._mt = new AWS.MTurk({ endpoint: ENDPOINT });
  this._question = new Question(this._mt);
}

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
  return /<FreeText>(.*?)<\/FreeText>/.exec(Answer)[1];
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

MechTurk.prototype._createVerify = function(assignments) {
  var params = assignments.map(a => {
    return {
      AssignmentId: a.AssignmentId,
      WorkerId: a.WorkerId,
      excerpt: this._getSentenceFromAnswer(a.Answer)
    };
  });

  return promisify.map(this._question, this._question.addVerify, params);
};

MechTurk.prototype._doVerify = function(assignments) {
  console.log(assignments);
  return Promise.resolve(assignments);
};

MechTurk.prototype._processHits = function(hits, recordType, verifyType) {
  return promisify.map(this, hit => {
    var HITId = hit.HITId;
    var HITTypeId = hit.HITTypeId;

    // We need createVerifyHITs as an entrypoint for psuedo recursion.
    return (function createVerifyHITs(NextToken) {
      var results;

      console.log('calling list for', little(HITId));
      return this._listAssignmentsForHIT({
        HITId: HITId,
        NextToken: NextToken
      })

      .then(r => {
        results = r;
        if (HITTypeId === recordType) {
          console.log('record assignment', HITId.substr(0,5),
                      results.Assignments.length);
          return this._createVerify(results.Assignments);
        } else if (HITTypeId === verifyType) {
          console.log('verify assignment', HITId.substr(0,5),
                      results.Assignments.length);
          return this._doVerify(results.Assignments);
        } else {
          console.error('Unrecognized hit type', hit);
        }
      })

      .then(() => {
        if (results.NextToken) {
          console.log('woulda, and em', little(HITId),
            little(results.NextToken));
          return createVerifyHITs.call(this, results.NextToken);
        }
      });

    }).call(this)

    .then(() => {
      console.log('updating status', little(HITId));
      this._updatHITReviewStatus(HITId, false);
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
      })).then(() => {

        if (!next) {
          return assignments.length;
        }

        return this._approveAll(next).then(r => {
          return assignments.length + r;
        });
      });
    });
};

/* Useful for later?
return Promise.all(results.HITs.map(hit => {
  var pending = hit.NumberOfAssignmentsPending;
  var available = hit.NumberOfAssignmentsAvailable;
  var completed = hit.NumberOfAssignmentsCompleted;
*/


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

  return this._listHITs(NextToken).then(hits => {
    var results = hits;

    return promisify.map(this, hit => {
      if (hit.HITStatus !== 'Rewiewable') {
        console.log('not reviewable');
        return 5;
      }

      console.log('delteing');
      return this._deleteHIT(hit.HITId).then(() => {
        ++deleted;
      }).catch(e => {
        console.error('del error', e.message);
      });
    }, hits.HITs)

    .then(() => {
      if (results.NextToken) {
        return this._deleteReviewable(results.NextToken);
      } else {
        return deleted;
      }
    });
  });
};

MechTurk.prototype.trim = function() {
  return this._deleteReviewable()
    .then(results => {
      console.log('deleted jobs', results);
    });
};

MechTurk.prototype.list = function(NextToken) {
  var results;

  return this._listHITs(NextToken).then(hits => {
    var results = hits;

    if (!hits.NumResults) {
      return;
    }


    hits.HITs.forEach(hit => {
      console.log(`hit ${hit.HITId.substr(0,4)} ${hit.HITStatus}`);
    });

    if (results.NextToken) {
      return this.list(results.NextToken);
    }
  });
};

MechTurk.prototype.add = function(count) {
  return this._question.add();
};

module.exports = new MechTurk();
