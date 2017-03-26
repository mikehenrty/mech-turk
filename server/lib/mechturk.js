const AWS = require('aws-sdk');
const Question = require('./question');
const promisify = require('./promisify');

const CONFIG_FILE = __dirname + '/../../config.json';
const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';

const DEFAULT_FEEDBACK = "Thanks for the great work!";

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

MechTurk.prototype._reviewAll = function(NextToken) {
  return this._listReviewableHITs(NextToken)
    .then(results => {
      var hits = results.HITs;
      var next = results.NextToken;

      return promisify.map(this, (hit) => {
        var HITId = hit.HITId;

        return (function createVerifyHITs(NextToken) {
          var results;

          return this._listAssignmentsForHIT({
            HITId: HITId,
            NextToken: NextToken
          })

          .then(r => {
            results = r;
            var as = results.Assignments;
            return promisify.map(this._question, this._question.addVerify,
                                 as.map((a) => {
              return {
                AssignmentId: a.AssignmentId,
                WorkerId: a.WorkerId,
                excerpt: this._getSentenceFromAnswer(a.Answer)
              };
            }));
          })

          .then(() => {
            if (results.NextToken) {
              return createVerifyHITs.call(this, results.NextToken);
            }
          });
        }).call(this)

        .then(() => {
          this._updatHITReviewStatus(HITId, false);
        });
      }, hits)

      .then((results) => {
        console.log('verify jobs created', results.length);
      });
    });
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


MechTurk.prototype.trim = function(NextToken) {
  var results;

  return this._listHITs(NextToken).then(hits => {
    var results = hits;

    if (!hits.NumResults) {
      return;
    }

    hits.HITs.forEach(hit => {
      this._deleteHIT(hit.HITId).then(results => {
        console.log('delete results', results);
      }).catch(e => {
        console.error('error delete', e);
      });
    });

    if (results.NextToken) {
      return this.list(results.NextToken);
    }
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
