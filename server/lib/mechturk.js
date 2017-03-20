
const AWS = require('aws-sdk');
const CONFIG_FILE = __dirname + '/../../config.json';
const ENDPOINT = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com';

function MechTurk() {
  AWS.config.loadFromPath(CONFIG_FILE);
  this._mt = new AWS.MTurk({ endpoint: ENDPOINT });
}

MechTurk.prototype._listAssignmentsForHIT = function(HITId) {
  return new Promise((resolve, reject) => {
    this._mt.listAssignmentsForHIT({HITId: HITId}, (err, assignments) => {
      if (err) {
        console.error('could not retrive assignments', HITId, err);
        reject(err);
        return;
      }
      resolve(assignments);
    });
  });
};

MechTurk.prototype._listHITs = function() {
  return new Promise((resolve, reject) => {
    this._mt.listHITs({}, function(err, hits) {
      if (err) {
        console.error('could not get hits', err);
        reject(err);
        return;
      }
      resolve(hits);
    });
  });
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

module.exports = new MechTurk();
