(function() {
  'use strict';
  const fs = require('fs');
  const path = require('path');
  const promisify = require('./promisify');

  const BASE_URL = 'https://mechturk.henretty.us/';
  // TODO: figure out production version of this.
  const HIT_URL = "https://workersandbox.mturk.com/mturk/preview?groupId=";

  const SENTENCES_FILE = path.resolve(__dirname, 'screenplaysfinal.txt');

  const DEFAULT_OPTIONS = {
    LifetimeInSeconds: 3600,
    MaxAssignments: 1
  };

  const HIT_RECORD = {
    Title: 'Read one English sentence out loud',
    Description: 'As simple as reading the sentence(s). - Voice',
    AssignmentDurationInSeconds: 600,
    Reward:'0.01',
    QualificationRequirements:[{
      QualificationTypeId:'00000000000000000071',
      Comparator: "In",
      LocaleValues: [{Country:'US'}, {Country: 'DE'}]
    }]
  };

  const HIT_VERIFY = {
    Title: 'Listen to a spoken sentence, and verify the words',
    Description: 'Verify spoken words. - Voice',
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

  function Question(mt, config) {
    this._mt = mt;
    this._baseUrl = config.serverRoot || BASE_URL;
    this._verifyUrl = this._baseUrl + 'verify.html';
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
    if (this._recordType) {
      return Promise.resolve(this._recordType);
    }

    return this._createHITType(HIT_RECORD)
      .then(results => {
        this._recordType = results.HITTypeId;
        return results.HITTypeId;
      });
  };

  Question.prototype.getVerifyHitType = function() {
    if (this._verifyType) {
      return Promise.resolve(this._verifyType);
    }

    return this._createHITType(HIT_VERIFY)
      .then(results => {
        this._verifyType = results.HITTypeId;
        return results.HITTypeId;
      });
  };

  Question.prototype.getType = function(typeId) {
    return Promise.all([
      this.getRecordHitType(),
      this.getVerifyHitType()
    ])

      .then((recordType, verifyType) => {
        if (typeId === recordType) {
          return 'recording';
        } else if (typeId === verifyType) {
          return 'verifying';
        } else {
          return 'unrecognized';
        }
      });
  };

  Question.prototype._getQuestionXMLTemplate = function(url, height) {
    url = url || this._baseUrl;
    height = height || 400;
    return `<ExternalQuestion xmlns="http://mechanicalturk.amazonaws.com/AWSMechanicalTurkDataSchemas/2006-07-14/ExternalQuestion.xsd">
      <ExternalURL>${url}</ExternalURL>
      <FrameHeight>${height}</FrameHeight>
      </ExternalQuestion>`;
  };

  Question.prototype._addWithType = function(type, o) {
    let options = Object.assign({}, DEFAULT_OPTIONS, o);
    return this._createHITType(type)

      .then(results => {
        options.HITTypeId = results.HITTypeId;
        return this._createHITWithHITType(options);
      })

      .then(hit => {
        hit = hit.HIT;
        // Good debug output when creating many hits.
        // console.log('new hit created', hit.Title, hit.HITTypeId.substr(0, 4));
        let url = HIT_URL + hit.HITTypeId;
        console.log(url);
        return url;
      });
  };

  Question.prototype._getQuestionFile = function() {
    return new Promise((resolve, reject) => {
      fs.readFile(SENTENCES_FILE, 'utf8', (err, data) => {
        if (err) {
          console.error('read file error', SENTENCES_FILE, err);
          reject(err);
          return;
        }

        resolve(data);
      });
    });
  };

  Question.prototype._getRandomQuestion = function() {
    return this._getQuestionFile()
      .then(lines => {
        lines = lines.split('\n').filter(function(s) {
          return !!s;
        });

        // Choose a random sentence from the lines.
        let n = Math.floor(Math.random() * lines.length);
        return lines[n];
      });
  };

  Question.prototype.add = function() {
    return this._getRandomQuestion()
      .then(sentence => {
        let url = this._baseUrl + '?sentence=' + sentence;
        return this._addWithType(HIT_RECORD, {
          Question: this._getQuestionXMLTemplate(url)
        });
      });
  };

  // We expect HITId, AssignmentId, WorkerId, and excerpt in the info array.
  Question.prototype.addVerify = function(info) {
    let url = this._verifyUrl + '?verifyid=' + info.AssignmentId +
      '&amp;previousworkerid=' + info.WorkerId +
      '&amp;excerpt=' + encodeURIComponent(info.excerpt);

    return this._addWithType(HIT_VERIFY, {
      Question: this._getQuestionXMLTemplate(url),
      RequesterAnnotation: info.HITId
    });
  };

  module.exports = Question;
})();
