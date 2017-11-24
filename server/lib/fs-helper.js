(function() {
  'use strict';

  const fs = require('fs-extra');
  const glob = require('glob');
  const path = require('path');
  const walk = require('walk');
  const promisify = require('./promisify');
  const Question = require('./question');

  const EXT_TXT = '.txt';
  const EXT_META = '.json';
  const EXT_VERIFY = '.verify';
  const EXT_GOOD = '.good';
  const EXT_BAD = '.bad';

  const UPLOAD_PATH = path.resolve( __dirname + '/../upload/');
  const FILE_GLOB = '/**/*.*';
  const RECORDED_DIR = 'recorded';
  const RECORDED_PATH = path.resolve(UPLOAD_PATH, RECORDED_DIR);
  const VERIFIED_DIR = 'verified';
  const VERIFIED_PATH = path.resolve(UPLOAD_PATH, VERIFIED_DIR);
  const REJECTED_DIR = 'rejected';
  const REJECTED_PATH = path.resolve(UPLOAD_PATH, REJECTED_DIR);
  const ACCEPTED_EXT = [ 'ogg', 'webm', 'm4a' ];

  function FSHelper() {
    this.clipCache = null;
  }

  FSHelper.EXT_TXT = EXT_TXT;
  FSHelper.EXT_META = EXT_META;
  FSHelper.EXT_VERIFY = EXT_VERIFY;
  FSHelper.EXT_GOOD = EXT_GOOD;
  FSHelper.EXT_BAD = EXT_BAD;
  FSHelper.UPLOAD_PATH = UPLOAD_PATH;
  FSHelper.RECORDED_DIR = RECORDED_DIR;
  FSHelper.RECORDED_PATH = RECORDED_PATH;
  FSHelper.VERIFIED_DIR = VERIFIED_DIR;
  FSHelper.VERIFIED_PATH = VERIFIED_PATH;
  FSHelper.REJECTED_DIR = REJECTED_DIR;
  FSHelper.REJECTED_PATH = REJECTED_PATH;
  FSHelper.ACCEPTED_EXT = ACCEPTED_EXT;

  FSHelper.prototype.getGlob = function(type, workerid, assignmentId, newAssignment) {
    assignmentId = assignmentId ? assignmentId : '';
    newAssignment = newAssignment ? '-' + newAssignment : '';
    return path.join(UPLOAD_PATH, type, workerid, assignmentId + newAssignment);
  };

  FSHelper.prototype.getTextFile = function(type, workerId, assignmentId, cb) {
    const fileName = this.getGlob(type, workerId, assignmentId) + EXT_TXT;
    fs.readFile(fileName, 'utf8', cb);
  };

  FSHelper.prototype.handleVerifyRequest =
    function(workerId, assignmentId, newWorkerId, answer, request) {
      return new Promise((res, rej) => {
        const ext = answer === 'yes' ? EXT_GOOD : EXT_BAD;
        const fileName =
          this.getGlob(RECORDED_DIR, workerId, assignmentId, newWorkerId) + ext;
        let writeStream = fs.createWriteStream(fileName);
        request.pipe(writeStream);
        request.on('end', (err, data) => {
          console.log('verify written', fileName);
          res();
        });
      });
    };

  FSHelper.prototype.writeRecordTextFile =
    function(workerId, assignmentId, sentence, cb) {
      const fileName = this.getGlob(RECORDED_DIR, workerId, assignmentId) + EXT_TXT;
      fs.writeFile(fileName, sentence, cb);
    };

  FSHelper.prototype.getMetaFile = function(type, workerId, assignmentId, cb) {
    const fileName = this.getGlob(type, workerId, assignmentId) + EXT_META;
    fs.readFile(fileName, 'utf8', (err, contents) => {
      if (err) {
        console.error('could not get metafile', fileName);
        cb(err);
        return;
      }

      let metadata = null;
      try {
        metadata = JSON.parse(contents);
      } catch (e) {
        console.error('could not parse clip meta', e);
        metadata = {};
      }

      cb(null, metadata);
    });
  };

  FSHelper.prototype.getMetaFileP = function(type, workerId, assignmentId) {
    return promisify(this, this.getMetaFile, [type, workerId, assignmentId]);
  };

  FSHelper.prototype.writeRecordMetaFile =
    function(hitId, workerId, assignmentId, ext, cb) {
      const fileName = this.getGlob(RECORDED_DIR, workerId, assignmentId) + EXT_META;
      const metadata = {
        hitId: hitId,
        assignmentId: assignmentId,
        ext: ext,
      };
      fs.writeFile(fileName, JSON.stringify(metadata), cb);
    };

  FSHelper.prototype.writeRecordMetaFileP =
    function(hitId, workerId, assignmentId, ext) {
      return promisify(this, this.writeRecordMetaFile,
          [hitId, workerId, assignmentId, ext]);
    };

  /* jshint ignore:start */
  FSHelper.prototype.markVerify =
    async function(workerId, assignmentId, verifyHitId) {
      const fileName =
        this.getGlob(RECORDED_DIR, workerId, assignmentId) + EXT_VERIFY;
      await promisify(fs, fs.writeFile, [fileName, verifyHitId]);
    };

  FSHelper.prototype.listClips = async function(force) {
    // TODO: if fetching clips takes a while, we may want to use this.
    // if (this.clipCache) {
    //   return this.clipCache;
    // }

    const globs = {};
    const fileGlob = UPLOAD_PATH + FILE_GLOB;
    const files = await promisify(null, glob, fileGlob);

    // Filter each of the files, and generate a clip metadata list.
    // The file we are looking for:
    //   *.mp3|ogg - the actual audio clip
    //   *.txt     - the text file containing the sentence read
    //   *.verify  - exists if this clip is vering verified, --> assignmentid
    //   *.bad     - a file representig bad vote, --> assignmentId
    //   *.good     - a file representig good vote, --> assignmentId
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.indexOf('README.md') !== -1) {
        continue;
      }

      const fragments = file.split('/');
      const name = fragments.pop();
      const workerId = fragments.pop();
      const type = fragments.pop();
      // Strip the .txt extension to grab assigment.
      let assignmentId = name.substr(0, name.lastIndexOf('.'));

      // If it is a vote file, we need to extract the assigment id of the glob.
      // File structure: workerid/assignmentid-voterid.good|bad
      if (assignmentId.indexOf('-') !== -1) {
          assignmentId = assignmentId.split('-')[0];
      }

      if (!globs[assignmentId]) {
        globs[assignmentId] = {
          workerId: workerId,
          assignmentId: assignmentId,
          type: type,
          good: 0,
          bad: 0,
          verifying: false,
        };
      }

      const ext = name.substr(name.indexOf('.'));
      switch (ext) {
        case EXT_VERIFY:
          globs[assignmentId].verifying = true;
          break;

        case EXT_BAD:
          ++globs[assignmentId].bad;
          break;

        case EXT_GOOD:
          ++globs[assignmentId].good;
          break;
      }
    }

    this.clipCache = Object.values(globs);
    return this.clipCache;
  };

  FSHelper.prototype.getClipInfo =
    async function(type, workerId, assignmentId) {
      let [sentence, metadata] = await Promise.all([
        promisify(this, this.getTextFile, [type, workerId, assignmentId]),
        promisify(this, this.getMetaFile, [type, workerId, assignmentId])
      ]);

      return {
        hitId: metadata.hitId,
        sentence: sentence,
        ext: metadata.ext,
      };
    };

  FSHelper.prototype.getVerifiable = async function() {
    let clips = await this.listClips();
    clips = clips.filter(clip => {
      return clip.type === RECORDED_DIR;
    });

    let verifiable = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      let info = null;
      try {
        info =
          await this.getClipInfo(clip.type, clip.workerId, clip.assignmentId);
      } catch (err) {
        console.error('clip no longer in recorded folder', clip);
      }

      if (info && !clip.verifying) {
        clip.hitId = info.hitId;
        clip.sentence = info.sentence;
        verifiable.push(clip);
      }
    }

    return verifiable;
  };


  /**
   * Move the clip into the verified folder.
   */
  FSHelper.prototype._verifyClip = async function(type, workerId, assignmentId) {
    const filePart = this.getGlob(RECORDED_DIR, workerId, assignmentId);
    const files = await promisify(null, glob, filePart + '*');

    for (let i = 0; i < files.length; i ++) {
      const source = files[i];
      const fileName = source.split('/').pop();
      const dest = this.getGlob(type, workerId) + '/' + fileName;
      await promisify(fs, fs.move, [source, dest]);
    }
  }

  FSHelper.prototype.verifyGood = function(workerId, assignmentId) {
    return this._verifyClip(VERIFIED_DIR, workerId, assignmentId);
  }

  FSHelper.prototype.verifyBad = function(workerId, assignmentId) {
    return this._verifyClip(REJECTED_DIR, workerId, assignmentId);
  }
  /* jshint ignore:end */

  module.exports = FSHelper;
})();
