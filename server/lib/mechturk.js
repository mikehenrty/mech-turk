const AWS = require('aws-sdk');
const fs = require('fs');

const CONFIG_FILE = __dirname + '/../../config.json';
const QUESTION_FILE = __dirname + '/my_question.xml';
const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';

const Q_TITLE = 'harpua';
const Q_DESC = 'test description';
const DEFAULT_FEEDBACK = "Thanks for the great work!";

function promisify(context, method, args) {
  if (!Array.isArray(args)) {
    args = [args];
  }

  return new Promise((resolve, reject) => {
    method.apply(context, args.concat([(err, result) => {
      if (err) {
        console.error('promise error', err);
        reject(err);
        return;
      }
      resolve(result);
    }]));
  });
}

function promiseMap(context, method, items) {
  return Promise.all(items.map(item => {
    return method.call(context, item);
  }));
}


function MechTurk() {
  AWS.config.loadFromPath(CONFIG_FILE);
  this._mt = new AWS.MTurk({ endpoint: ENDPOINT });
}

MechTurk.prototype._deleteHIT = function(HITId) {
  return promisify(this._mt, this._mt.deleteHIT, { HITId });
};

MechTurk.prototype._createHIT = function(options) {
  return promisify(this._mt, this._mt.createHIT, options);
};

MechTurk.prototype._listAssignmentsForHIT = function(options) {
  options.MaxResults = options.MaxResults || 100;
  options.AssignmentStatuses = ['Submitted'];
  return promisify(this._mt, this._mt.listAssignmentsForHIT, options);
};

MechTurk.prototype._listHITs = function() {
  return promisify(this._mt, this._mt.listHITs, {});
};

MechTurk.prototype._listReviewableHITs = function() {
  return promisify(this._mt, this._mt.listReviewableHITs, {});
};

MechTurk.prototype._approveAssignment = function(id) {
  return promisify(this._mt, this._mt.approveAssignment, {
    AssignmentId: id,
    RequesterFeedback: DEFAULT_FEEDBACK
  });
};

MechTurk.prototype._getQuestion = function() {
  return promisify(fs, fs.readFile, [QUESTION_FILE, 'utf8']);
};

MechTurk.prototype._getAssigments = function() {
  return this._listReviewableHITs()
    .then(results => {
      return promiseMap(this, this._listAssignmentsForHIT, results.HITs);
    })
    .then(results => {
      var assignments = [];
      results.forEach(hit => {
        assignments = assignments.concat(hit.Assignments);
      });
      return assignments;
    });
};

MechTurk.prototype.list = function() {
  return this._listHITs().then(hits => {

    if (!hits.NumResults) {
      console.log('no hits for current user');
      return;
    }

    hits.HITs.forEach(hit => {
      console.log(`\n\nhit ${hit.HITId.substr(0,4)} ${hit.HITStatus}`);
      console.log(hit);
    });
  });
};

MechTurk.prototype.approve = function() {
  return this._getAssigments()
    .then(assignments => {
      if (assignments.length === 0) {
        return 0;
      }

      return promiseMap(this, this._approveAssignment, assignments.map(a => {
        return a.AssignmentId;
      }))
      .then(() => {
        return assignments.length;
      });
    })
    .then(approved => {
      console.log(`approved ${approved} assignments`);
    });


    /* Might need these string consts later for auto complete.
      var pending = hit.NumberOfAssignmentsPending;
      var available = hit.NumberOfAssignmentsAvailable;
      var completed = hit.NumberOfAssignmentsCompleted;
    */
};

MechTurk.prototype.add = function() {
  return this._getQuestion()
    .then(question => {
      return this._createHIT({
        Title: Q_TITLE,
        Description: Q_DESC,
        MaxAssignments: 1,
        LifetimeInSeconds: 3600,
        AssignmentDurationInSeconds: 600,
        Reward:'0.05',
        Question: question,
        QualificationRequirements:[{
          QualificationTypeId:'00000000000000000071',
          Comparator: "In",
          LocaleValues: [{Country:'US'}, {Country: 'DE'}]
        }]
      });
    })
    .then(hit => {
      hit = hit.HIT;
      console.log('new hit created', hit.Title, hit.HITId.substr(0, 4));
    });
};

module.exports = new MechTurk();
