(function() {
  'use strict';

  var MIN_DB_LEVEL = -85;      // The dB level that is 0 in the levels display
  var MAX_DB_LEVEL = -30;      // The dB level that is 100% in the levels display
  var LOUD_THRESHOLD = -40;    // Above this dB level we display in red
  var SILENCE_THRESHOLD = -65; // Levels below this db threshold count as silence
  var SILENCE_DURATION = 1.5;  // How many seconds of quiet before stop recording
  var STOP_BEEP_HZ = 440;      // Frequency and duration of beep
  var STOP_BEEP_S = 0.3;
  var rightside = true;

  var REPLAY_TIMEOUT = 200;

  // The microphone stream we get from getUserMedia
  var microphone;

  // The sentences we want the user to read and their corresponding
  // server-side directories that we upload them to.  We fetch these
  // from the server. See getSentences() and parseSentences().
  var sentences = [], directories = [];

  // The sentence we're currently recording.
  var currentSentence;

  // These are some things that can go wrong:
  var ERR_NO_RECORDING = 'Please record first.';
  var ERR_NO_PLAYBACK = 'Please listen before submitting.';
  var ERR_PREVIEW = 'Please click "Accept HIT" to record your voice.';
  var ERR_PLATFORM = 'Your browser does not support audio recording.';
  var ERR_NO_CONSENT = 'You did not consent to recording. ' +
    'You must click the "I Agree" button in order to use this website.';
  var ERR_NO_MIC = 'You did not allow this website to use the microphone. ' +
    'The website needs the microphone to record your voice.';
  var ERR_UPLOAD_FAILED = 'Uploading your recording to the server failed. ' +
    'This may be a temporary problem. Please try again.';
  var ERR_DATA_FAILED = 'Submitting your profile data failed. ' +
    'This may be a temporary problem. Please try again.';

  var SOUNDCLIP_URL = '/upload/';

  var $ = document.querySelector.bind(document);

  function setMessage(message) {
    var m = $('#message');
    m.textContent = message;
    m.className = 'panel';
  }

  function empty(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  // This is the program startup sequence.
  function getQuery() {
    if (window._query) {
      return window._query;
    }
    var query = location.search.substr(1);
    var result = {};
    query.split("&").forEach(function(part) {
      var item = part.split("=");
      result[item[0]] = decodeURIComponent(item[1]);
    });
    window._query = result;
    return result;
  }

  function checkPlatformSupport() {
    function isWebAudioSupported() {
      return typeof window.AudioContext === 'function';
    }

    function isGetUserMediaSupported() {
      var gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) ||
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia;
      return typeof gum === 'function';
    }

    function isMediaRecorderSupported() {
      return typeof window.MediaRecorder === 'function';
    }

    if (!isGetUserMediaSupported() || 
      !isWebAudioSupported() ||
      !isMediaRecorderSupported()) {
      return Promise.reject(ERR_PLATFORM);
    }
    else {
      return Promise.resolve(true);
    }
  }

  function validatePage() {
    var query = getQuery();
    if (query.assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
      return Promise.reject(ERR_PREVIEW);
    }

    // Load forms with required assignmentId field.
    var inputs = document.querySelectorAll('.assignmentId');
    [].forEach.call(inputs, function(input) {
      input.value = query.assignmentId;
    });
  }

  // Use getUserMedia() to get access to the user's microphone.
  // This can fail because the browser does not support it, or
  // because the user does not give permission.
  function getMicrophone() {
    return new Promise(function(res,reject) {
      function resolve(stream) {
        microphone = stream;
        res(stream);
      }
      // Reject the promise with a 'permission denied' error code
      function deny() { reject(ERR_NO_MIC); }

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({audio: true}).then(resolve, deny);
      }
      else if (navigator.getUserMedia) {
        navigator.getUserMedia({audio:true}, resolve, deny);
      }
      else if (navigator.webkitGetUserMedia) {
        navigator.webkitGetUserMedia({audio:true}, resolve, deny);
      }
      else if (navigator.mozGetUserMedia) {
        navigator.mozGetUserMedia({audio:true}, resolve, deny);
      }
      else {
        reject(ERR_PLATFORM);  // Browser does not support getUserMedia
      }
    });
  }

  // TODO: this doesn't need to be asyncrous anymore.
  // Grab the sentence from the query string.
  function getSentences() {
    var query = getQuery();
    sentences = [query.sentence];
    return Promise.resolve(sentences);
  }

  // If anything goes wrong in the app startup sequence, this function
  // is called to tell the user what went wrong
  function displayErrorMessage(error) {
    $('#record-progress').className = '';
    $('#upload-progress').className = '';
    var recordScreen = document.querySelector('#record-screen');
    recordScreen.classList.add('disabled');
    recordScreen.hidden = false;

    setMessage(error);
    document.querySelector('#title').textContent = '';

    if (error === ERR_PLATFORM) {
      // Fatal error. Just show a table of supported browsers
      document.querySelector('#error-reload').hidden = true;
      document.querySelector('#error-supported').hidden = false;
      document.querySelector('#error-screen').hidden = false;
    }
    else if (error === ERR_PREVIEW) {
      document.querySelector('#error-reload').hidden = true;
      document.querySelector('#error-supported').hidden = true;
    } else {
      // Otherwise, the user can correct the errror. Invite them to reload
      document.querySelector('#error-reload').hidden = false;
      document.querySelector('#error-supported').hidden = true;
      document.querySelector('#error-screen').hidden = false;
    }
  }

  function RecordingScreen(element, microphone) {
    this.element = element;
    this.player = element.querySelector('#player');

    // Build the WebAudio graph we'll be using
    var audioContext = new AudioContext();
    var sourceNode = audioContext.createMediaStreamSource(microphone);
    var volumeNode = audioContext.createGain();
    var analyzerNode = audioContext.createAnalyser();
    var outputNode = audioContext.createMediaStreamDestination();
    // make sure we're doing mono everywhere
    sourceNode.channelCount = 1;
    volumeNode.channelCount = 1;
    analyzerNode.channelCount = 1;
    outputNode.channelCount = 1;
    // connect the nodes together
    sourceNode.connect(volumeNode);
    volumeNode.connect(analyzerNode);
    analyzerNode.connect(outputNode);
    // and set up the recorder
    var recorder = new MediaRecorder(outputNode.stream);
    var chunks = [];

    // Set up the analyzer node, and allocate an array for its data
    // FFT size 64 gives us 32 bins. But those bins hold frequencies up to
    // 22kHz or more, and we only care about visualizing lower frequencies
    // which is where most human voice lies, so we use fewer bins
    analyzerNode.fftSize = 64;
    var bufferLength = analyzerNode.frequencyBinCount;
    var frequencyBins = new Float32Array(bufferLength);

    // Another audio node used by the beep() function
    var beeperVolume = audioContext.createGain();
    beeperVolume.connect(audioContext.destination);

    // This canvas object displays the audio levels for the incoming signal
    var levels = element.querySelector('#levels');

    var recording = false;  // Are we currently recording?
    var lastSoundTime;      // When was the last time we heard a sound?

    var recordButton = element.querySelector('#recordButton');
    var playButton = element.querySelector('#playButton');
    var uploadButton = element.querySelector('#uploadButton');
    var canuploadandplay = false;
    var playing = false;

    // How much we amplify the signal from the microphone.
    // If we've got a saved value, use that.
    var microphoneGain = parseFloat(localStorage.microphoneGain);

    // CLOCK!
    var timeBegan = null;
    var timeStopped = null;
    var stoppedDuration = 0;
    var started = null;

    function clockreset() {
      clearInterval(started);
      stoppedDuration = 0;
      timeBegan = null;
      timeStopped = null;
      document.getElementById("elapsedtime").innerHTML = "00.0s";
    }

    function clockRunning(){
      var currentTime = new Date();
      var timeElapsed = new Date(currentTime - timeBegan - stoppedDuration);
      /*
    var hour = timeElapsed.getUTCHours();
    var min = timeElapsed.getUTCMinutes();
    */
      var sec = timeElapsed.getUTCSeconds();
      var ms = Math.round(timeElapsed.getUTCMilliseconds() / 100);

      document.getElementById("elapsedtime").innerHTML =
        (sec > 9 ? sec : "0" + sec) + "." + ms + 's';
    }

    function clockstart() {
      clockreset();
      if (timeBegan === null) {
        timeBegan = new Date();
      }

      if (timeStopped !== null) {
        stoppedDuration += (new Date() - timeStopped);
      }
      started = setInterval(clockRunning, 100);
    }

    function clockstop() {
      timeStopped = new Date();
      clearInterval(started);
    }

    // After REPLAY_TIMEOUT, replay the recorded clip.
    this.player.addEventListener('canplaythrough', function() {
      setTimeout(function() { this.player.play(); }.bind(this),    REPLAY_TIMEOUT);
    }.bind(this));

    this.player.addEventListener('play', function() {
      playing = true;
    }.bind(this));

    // After player ended, make sure to enable submission (again).
    this.player.addEventListener('ended', function() {
      playing = false;
      $('#recordButton').textContent = 'Record';
      this.player.className = ''; // Remove disabled.
      $('#uploadButton').classList.add('active');
    }.bind(this));

    // A RecordingScreen object has methods for hiding and showing.
    // Everything else is private inside this constructor
    this.show = function(sentence) {
      clockreset();
      this.element.querySelector('#sentence').textContent = '"' + sentence + '"';
      this.element.hidden = false;
    }.bind(this);

    this.play = function(recording) {
      this.recording = recording;
      this.player.src = URL.createObjectURL(recording);
    }.bind(this);

    this.discards = function() {
      document.querySelector('#playButton').style.color = "rgb(188,189,192)";
      document.querySelector('#uploadButton').style.color = "rgb(188,189,192)";

      canuploadandplay = false;
      this.recording = null;
      if (this.player.src) {
        URL.revokeObjectURL(this.player.src);
        this.player.src = "";
        this.player.load();
      }
    }.bind(this);


    recorder.ondataavailable = function(e) {
      chunks.push(e.data);
    };

    recorder.onstop = function() {
      recordButton.className = '';
      var blob = new Blob(chunks, { 'type' : 'audio/ogg; codecs=opus' });
      element.dispatchEvent(new CustomEvent('record', {
        detail: blob
      }));
      chunks = [];
    };

    // If no saved value, start with a reasonable default
    // See PlaybackScreen for the code that allows the user to change this
    if (!microphoneGain) {
      // Need to turn the sensitivity way up on Android
      if (navigator.userAgent.indexOf('ndroid') !== -1) {
        microphoneGain = 5;
      }
      else {
        microphoneGain = 2;
      }
      localStorage.microphoneGain = microphoneGain;
    }

    var sensitivity = element.querySelector('#sensitivity');
    sensitivity.onchange = function() {
      microphoneGain = parseFloat(this.value)/10;
      volumeNode.gain.value = microphoneGain;
      localStorage.microphoneGain = microphoneGain;
    }.bind(this);
    sensitivity.value = microphoneGain * 10;
    volumeNode.gain.value = microphoneGain;

    function startRecording() {
      // I wanted to do a beep to indicate the start of recording
      // But it was too hard to not record the end of the beep,
      // particularly on Chrome.
      if (!recording) {
        clockstart();
        recording = true;
        lastSoundTime = audioContext.currentTime;

        // We want to be able to record up to 60s of audio in a single blob.
        // Without this argument to start(), Chrome will call dataavailable
        // very frequently.
        recorder.start(20000);
        recordButton.textContent = 'Stop';
        $('#player').className = 'disabled';
        $('#record-progress').className = 'progress small active';

        document.querySelector('#uploadButton').classList.remove('active');
        document.body.className = 'recording';
      }
    }

    function stopRecording() {
      if (recording) {
        canuploadandplay = true;
        clockstop();
        recording = false;
        document.body.className = '';
        recordButton.className = 'disabled'; // disabled 'till after the beep
        $('#record-progress').className = 'progress small';
        empty(recordButton);
        recordButton.textContent = 'Playing';
        recorder.stop();
      }
    }

    function visualize() {
      // Clear the canvas
      var context = levels.getContext('2d');
      context.clearRect(0, 0, levels.width, levels.height);

      // Get the FFT data
      analyzerNode.getFloatFrequencyData(frequencyBins);

      // Display it as a barchart.
      // Drop bottom few bins, since they are often misleadingly high
      var skip = 2;
      var n = frequencyBins.length - skip;
      var barwidth = levels.width/n;
      var maxValue = MIN_DB_LEVEL;
      var dbRange = (MAX_DB_LEVEL - MIN_DB_LEVEL);
      // Loop through the values and draw the bars
      // while we're at it, find the maximum value
      rightside = !rightside;

      for(var i = 0; i < n; i++) {
        var value = frequencyBins[i+skip];
        if (value > maxValue) {
          maxValue = value;
        }
        var ratio = (value - MIN_DB_LEVEL) / dbRange;
        var height = levels.height * ratio;
        if (height < 0) {
          continue;
        }

        // calculate height
        var total;
        var inverso;
        total = levels.height - height - 50;
        inverso = total + height;

        // here other side
        var x_bar = i * barwidth;

        var fillStyle = 'black';
        if (recording) {
          var r = Math.round(100 + (ratio) * 255 * 2.5);
          var g = 24;
          var b = 24;
          fillStyle = 'rgb(' + r + ', ' + g + ', ' + b + ')';
        }

        context.fillStyle = fillStyle;
        context.fillRect(x_bar, total,
          barwidth, height);
        context.fillStyle = 'white';
        context.fillRect(x_bar+25, total,
          barwidth, height);


        context.fillStyle = fillStyle;
        context.fillRect(x_bar, inverso,
          barwidth, height);
        context.fillStyle = 'white';
        context.fillRect(x_bar+25, inverso,
          barwidth, height+20);

      }

      // If we are currently recording, then test to see if the user has
      // been silent for long enough that we should stop recording
      if (recording) {
        var now = audioContext.currentTime;
        if (maxValue < SILENCE_THRESHOLD) {
          if (now - lastSoundTime > SILENCE_DURATION) {
            stopRecording();
          }
        }
        else {
          lastSoundTime = now;
        }
      }

      // Update visualization faster when recording.
      /*
    if (recording) {
      requestAnimationFrame(visualize);
    } else {
      setTimeout(visualize, 70)
    }
    */
      setTimeout(visualize, 50);
    }

    // The button responds to clicks to start and stop recording
    recordButton.addEventListener('click', function() {
      // Don't respond if we're disabled
      if (recordButton.className === 'disabled') {
        return;
      }

      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    });

    uploadButton.addEventListener('click', function() {
      if (!canuploadandplay) {
        setMessage(ERR_NO_RECORDING);
        return;
      } else if (playing) {
        setMessage(ERR_NO_PLAYBACK);
        return;
      }

      $('#upload-progress').className = 'progress small active';
      element.dispatchEvent(new CustomEvent('upload', {detail: this.recording}));
    }.bind(this));

    playButton.addEventListener('click', function() {
      if (!canuploadandplay) {
        return;
      }

      this.player.play();
    }.bind(this));

    visualize();
  }

  // Once the async initialization is complete, this is where the
  // program really starts. It initializes the recording and playback
  // screens, and sets up event handlers to switch back and forth between
  // those screens until the user gets tired of making recordings.
  function initializeAndRun() {

    var m = $('#message');
    m.className = 'panel disabled';
    var o = $('#overlay');
    o.className = 'disabled';
    document.querySelector('#record-screen').classList.remove('disabled');

    // Get the DOM elements for the recording and playback screens
    var recordingScreenElement = document.querySelector('#record-screen');

    // Create objects that encapsulate their functionality
    // Then set up event handlers to coordinate the two screens
    var recordingScreen = new RecordingScreen(recordingScreenElement, microphone);

    // Here's how we switch to the recording screen
    function switchToRecordingScreen(needNewSentence) {
      // TODO: refactor, we dont need multiple sentences
      // Assign the current sentence if we don't have one.
      if (needNewSentence || !currentSentence) {
        currentSentence = sentences[0];
        document.getElementById('excerpt').value = currentSentence;
      }

      // Hide the playback screen (and release its audio) if it was displayed
      // Show the recording screen
      document.querySelector('#title').textContent =
        'Press record and Read out loud:';
      recordingScreen.show(currentSentence);
    }

    // Upload a recording using the fetch API to do an HTTP POST
    function upload(recording) {
      if (!recording.type) {
        // Chrome doesn't give the blob a type
        recording = new Blob([recording], {type:'audio/webm;codecs=opus'});
      }

      var headers = new Headers();
      headers.append('uid', getQuery().workerId);
      headers.append('sentence', currentSentence);
      headers.append('assignmentid', getQuery().assignmentId);

      return fetch(SOUNDCLIP_URL, {
        method: 'POST',
        headers: headers,
        body: recording
      }).then(function(response) {
        if (response.status !== 200) {
          throw (ERR_UPLOAD_FAILED);
        }
        return response.text();
      });
    }

    // When a recording is complete, pass it to the playback screen
    recordingScreenElement.addEventListener('record', function(event) {
      recordingScreen.play(event.detail);
    });

    // If the user clicks 'Upload' on the playback screen, do the upload
    // and submit the form.
    recordingScreenElement.addEventListener('upload', function(event) {
      upload(event.detail).then(function() {
        document.getElementById('assignmentId').form.submit();
      }).catch(function(e) {
        console.error('upload error', e);
        displayErrorMessage(ERR_UPLOAD_FAILED);
      });
    });

    // If the user clicks 'Discard', switch back to the recording screen
    // for another take of the same sentence
    recordingScreenElement.addEventListener('discard', function() {
      switchToRecordingScreen(false);
    });

    // Finally, we start the app off by displaying the recording screen
    switchToRecordingScreen(true);
  }

  // The RecordingScreen object has show() and hide() methods and fires
  // a 'record' event on its DOM element when a recording has been made.

  checkPlatformSupport()
    .then(validatePage)
    .then(function() {
      setMessage('Loading...');
      var rec = document.getElementById('record-screen');
      rec.hidden = false;
      return Promise.all([getMicrophone(), getSentences()])
        .then(initializeAndRun);
    })
    .catch(displayErrorMessage);
})();
