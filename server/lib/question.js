const promisify = require('./promisify');

const BASE_URL = 'https://mechturk.henretty.us/';

const DEFAULT_OPTIONS = {
  LifetimeInSeconds: 3600,
  MaxAssignments: 1
};

const HIT_RECORD = {
  Title: 'VoiceBank',
  Description: 'Read English sentences out loud.',
  AssignmentDurationInSeconds: 600,
  Reward:'0.01',
  QualificationRequirements:[{
    QualificationTypeId:'00000000000000000071',
    Comparator: "In",
    LocaleValues: [{Country:'US'}, {Country: 'DE'}]
  }]
};

const HIT_VERIFY = {
  Title: 'VoiceBank - Verify',
  Description: 'Verify spoken words.',
  AssignmentDurationInSeconds: 600,
  Reward:'0.01',
  QualificationRequirements:[{
    QualificationTypeId:'00000000000000000071',
    Comparator: "In",
    LocaleValues: [{Country:'US'}, {Country: 'DE'}]
  }]
};


function choose(option1, option2) {
  return typeof option1 !== 'undefined' ? options1: option2;
}

function Question(mt) {
  this._mt = mt;
}

Question.prototype._createHIT = function(options) {
  return promisify(this._mt, this._mt.createHIT, options);
};

Question.prototype._createHITType = function(options) {
  return promisify(this._mt, this._mt.createHITType, options);
};

Question.prototype._createHITWithHITType = function(options) {
  return promisify(this._mt, this._mt.createHITWithHITType, options);
};

Question.prototype.getRecordHitType = function() {
  return this._createHITType(HIT_RECORD)
    .then(results => {
      return results.HITTypeId;
    });
};

Question.prototype.getVerifyHitType = function() {
  return this._createHITType(HIT_VERIFY)
    .then(results => {
      return results.HITTypeId;
    });
};

Question.prototype._getQuestionXMLTemplate = function(url, height) {
  url = url || BASE_URL;
  height = height || 400;
  return `<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">
      <ExternalURL>${url}</ExternalURL>
    <FrameHeight>${height}</FrameHeight>
    </ExternalQuestion>`;
};

Question.prototype._addWithType = function(type, o) {
  var options = Object.assign({}, DEFAULT_OPTIONS, o);
  return this._createHITType(type)

    .then(results => {
      options.HITTypeId = results.HITTypeId;
      return this._createHITWithHITType(options);
    })

    .then(hit => {
      console.log('new hit created', hit.HIT.Title,
                  hit.HIT.HITTypeId.substr(0, 4));
      console.log(
          "https://workersandbox.mturk.com/mturk/preview?groupId=" +
          hit.HIT.HITTypeId);
    });
};

Question.prototype.add = function(options) {
  return this._addWithType(HIT_RECORD, {
    Question: this._getQuestionXMLTemplate()
  });
};

// We expect AssignmentId, WorkerId, and excerpt in the info array.
Question.prototype.addVerify = function(info) {
  var url = BASE_URL + '?verifyid=' + info.AssignmentId +
                       '&amp;previousworkerid=' + info.WorkerId +
                       '&amp;excerpt=' + encodeURIComponent(info.excerpt);

  return this._addWithType(HIT_VERIFY, {
    Question: this._getQuestionXMLTemplate(url)
  });
};

module.exports = Question;
