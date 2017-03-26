const promisify = require('./promisify');

const BASE_URL = 'https://mechturk.henretty.us/';

const DEFAULT_OPTIONS = {
  Title: 'VoiceBank',
  Description: 'Read English sentences out loud.',
  MaxAssignments: 1,
  LifetimeInSeconds: 3600,
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

Question.prototype._getQuestionXMLTemplate = function(url, height) {
  url = url || BASE_URL;
  height = height || 400;
  return `<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">
      <ExternalURL>${url}</ExternalURL>
    <FrameHeight>${height}</FrameHeight>
    </ExternalQuestion>`;
};

Question.prototype.add = function(o) {
  var options = Object.assign({}, DEFAULT_OPTIONS, o);
  if (!options.Question) {
    options.Question = this._getQuestionXMLTemplate();
  }

  return this._createHIT(options)
    .then(hit => {
      hit = hit.HIT;
      console.log('new hit created', hit.Title, hit.HITId.substr(0, 4));
    });
};

Question.prototype.addVerify = function(info) {
  var options = {
    Title: 'VoiceBank - Verify'
  };
  var url = BASE_URL + '?verifyid=' + info.AssignmentId +
                       '&amp;previousworkerid=' + info.WorkerId +
                       '&amp;excerpt=' + encodeURIComponent(info.excerpt);
  options.Question = this._getQuestionXMLTemplate(url);
  return this.add(options);
};

module.exports = Question;
