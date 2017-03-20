const AWS = require('aws-sdk');
const fs = require('fs');

const CONFIG_FILE = __dirname + '/../../config.json';
const QUESTION_FILE = __dirname + '/my_question.xml';
const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';

const Q_TITLE = 'harpua';
const Q_DESC = 'test description';

function promisify(context, method, args) {
  if (!Array.isArray(args)) {
    args = [args];
  }

  return new Promise((resolve, reject) => {
    method.apply(context, args.concat([(err, result) => {
      if (err) {
        console.error('error', method.name, err);
        reject(err);
        return;
      }
      resolve(result);
    }]));
  });
}

function MechTurk() {
  AWS.config.loadFromPath(CONFIG_FILE);
  this._mt = new AWS.MTurk({ endpoint: ENDPOINT });
}

MechTurk.prototype._createHIT = function(options) {
  return promisify(this._mt, this._mt.createHIT, options);
};

MechTurk.prototype._listAssignmentsForHIT = function(HITId) {
  return promisify(this._mt, this._mt.listAssignmentsForHIT, { HITId });
};

MechTurk.prototype._listHITs = function() {
  return promisify(this._mt, this._mt.listHITs, {});
};

MechTurk.prototype._getQuestion = function() {
  return promisify(fs, fs.readFile, [QUESTION_FILE, 'utf8']);
};

MechTurk.prototype.list = function() {
  return this._listHITs().then(hits => {

    if (!hits.NumResults) {
      console.log('no hits for current user');
      return;
    }

    hits.HITs.forEach(hit => {
      console.log(`hit ${hit.HITId.substr(0,4)} ${hit.HITStatus}`);
      this._listAssignmentsForHIT(hit.HITId).then(assignments => {
        console.log('got some assignments for it');
      });
    });
  });
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
