// These are configurable constants:
var MIN_DB_LEVEL = -85;      // The dB level that is 0 in the levels display
var MAX_DB_LEVEL = -30;      // The dB level that is 100% in the levels display
var LOUD_THRESHOLD = -40;    // Above this dB level we display in red
var SILENCE_THRESHOLD = -65; // Levels below this db threshold count as silence
var SILENCE_DURATION = 1.5;  // How many seconds of quiet before stop recording
var STOP_BEEP_HZ = 440;      // Frequency and duration of beep
var STOP_BEEP_S = 0.3;
var rightside = true;

// The microphone stream we get from getUserMedia
var microphone;

// The sentences we want the user to read and their corresponding
// server-side directories that we upload them to.  We fetch these
// from the server. See getSentences() and parseSentences().
var sentences = [], directories = [];

// The sentence we're currently recording, and its directory.
// These are picked at random in recordingScreen.show()
var currentSentence, currentDirectory;

// These are some things that can go wrong:
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

// This is the program startup sequence.
checkPlatformSupport()
  .then(validatePage)
  .then(function() {
    return Promise.all([getMicrophone(), getSentences()]);
  })
  .then(initializeAndRun)
  .catch(displayErrorMessage);

function getQuery() {
  var query = location.search.substr(1);
  var result = {};
  query.split("&").forEach(function(part) {
    var item = part.split("=");
    result[item[0]] = decodeURIComponent(item[1]);
  });
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

  var assignmentId = document.getElementById('assignmentId');
  assignmentId.value = query.assignmentId;
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

// Fetch the sentences.json file that tell us what sentences
// to ask the user to read
function getSentences() {
  return fetch('./data/screenplaysfinal.txt').then(function(r) {
    return r.text().then(function(text) {
      sentences = text.split('\n').filter(function(s) {
        return !!s;
      });
    });
  });
}

// If anything goes wrong in the app startup sequence, this function
// is called to tell the user what went wrong
function displayErrorMessage(error) {
  document.querySelector('#record-screen').classList.add('disabled');
  document.querySelector('#error-screen').hidden = false;
  document.querySelector('#error-message').textContent = error;
  document.querySelector('#title').textContent = '';

  if (error === ERR_PLATFORM) {
    // Fatal error. Just show a table of supported browsers
    document.querySelector('#error-reload').hidden = true;
    document.querySelector('#error-supported').hidden = false;
  }
  else if (error === ERR_PREVIEW) {
    // Fatal error. Just show a table of supported browsers
    document.querySelector('#error-reload').hidden = true;
    document.querySelector('#error-supported').hidden = true;
  } else {
    // Otherwise, the user can correct the errror. Invite them to reload
    document.querySelector('#error-reload').hidden = false;
    document.querySelector('#error-supported').hidden = true;
  }
}

// Once the async initialization is complete, this is where the
// program really starts. It initializes the recording and playback
// screens, and sets up event handlers to switch back and forth between
// those screens until the user gets tired of making recordings.
function initializeAndRun() {
  document.querySelector('#record-screen').classList.remove('disabled');
  var totalsess = 0;
  // Get the DOM elements for the recording and playback screens
  var recordingScreenElement = document.querySelector('#record-screen');

  // Create objects that encapsulate their functionality
  // Then set up event handlers to coordinate the two screens
  var recordingScreen = new RecordingScreen(recordingScreenElement, microphone);

  // When a recording is complete, pass it to the playback screen
  recordingScreenElement.addEventListener('record', function(event) {
    recordingScreen.play(event.detail);
  });

  // If the user clicks 'Upload' on the playback screen, do the upload
  // and switch back to the recording screen for a new sentence
  recordingScreenElement.addEventListener('upload', function(event) {
    document.getElementById('assignmentId').form.submit();
    // upload(currentDirectory, event.detail);
    // switchToRecordingScreen(true);
  });

  // If the user clicks 'Discard', switch back to the recording screen
  // for another take of the same sentence
  recordingScreenElement.addEventListener('discard', function() {
    switchToRecordingScreen(false);
  });

  // Here's how we switch to the recording screen
  function switchToRecordingScreen(needNewSentence) {
    // Pick a random sentence if we don't have one or need a new one
    if (needNewSentence || !currentSentence) {
      var n = Math.floor(Math.random() * sentences.length);
      currentSentence = sentences[n];
      currentDirectory = directories[n];
    }

    // Hide the playback screen (and release its audio) if it was displayed
    // Show the recording screen
    document.querySelector('#title').textContent =
      'Press record and Read out loud:';
    recordingScreen.show(currentSentence);
  }

  // Upload a recording using the fetch API to do an HTTP POST
  function upload(directory, recording) {
    if (!recording.type) {
      // Chrome doesn't give the blob a type
      recording = new Blob([recording], {type:'audio/webm;codecs=opus'});
    }

    var headers = new Headers();
    headers.append("uid", localStorage.getUserInfoGiven);

    fetch('/upload/' + directory,
      { method: 'POST', headers: headers, body: recording })
      .then(function(response) {
        if (response.status !== 200) {
          displayErrorMessage(ERR_UPLOAD_FAILED + ' ' + response.status + ' ' +
                              response.statusText);
        } else {
          // sum one
          totalsess++;
          recordingScreen.discards();
        }
      })
      .catch(function() {
        displayErrorMessage(ERR_UPLOAD_FAILED);
      });
  }

  // Finally, we start the app off by displaying the recording screen
  switchToRecordingScreen(true);
}

// The RecordingScreen object has show() and hide() methods and fires
// a 'record' event on its DOM element when a recording has been made.
function RecordingScreen(element, microphone) {
  this.element = element;
  this.player = element.querySelector('#player');

  // A RecordingScreen object has methods for hiding and showing.
  // Everything else is private inside this constructor
  this.show = function(sentence) {
    clockreset();
    this.element.querySelector('#sentence').textContent = '"' + sentence + '"';
    this.element.hidden = false;
  };

  this.play = function(recording) {
    this.recording = recording;
    this.player.src = URL.createObjectURL(recording);
  };

  this.discards = function() {
    element.querySelector('#playimg').src = "imgs/Triangle-09-off.png";
    element.querySelector('#submitimg').src = "imgs/CheckMark-off.png";
      document.querySelector('#lblplay').style.color = "rgb(188,189,192)";
      document.querySelector('#lblsubmit').style.color = "rgb(188,189,192)";

    canuploadandplay = false;
    this.recording = null;
    if (this.player.src) {
      URL.revokeObjectURL(this.player.src);
      this.player.src = "";
      this.player.load();
    }
  };

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

  // Set up the analyzer node, and allocate an array for its data
  // FFT size 64 gives us 32 bins. But those bins hold frequencies up to
  // 22kHz or more, and we only care about visualizing lower frequencies
  // which is where most human voice lies, so we use fewer bins
  analyzerNode.fftSize = 64;
  var frequencyBins = new Float32Array(14);

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

  // How much we amplify the signal from the microphone.
  // If we've got a saved value, use that.
  var microphoneGain = parseFloat(localStorage.microphoneGain);

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
  };
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
      document.querySelector('#lblrecord').textContent = 'Stop';
      document.querySelector('#divanim').className = 'recording-indicator';
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
      recorder.ondataavailable = function(event) {
        // Only call us once
        recorder.ondataavailable = null;

        // Beep to tell the user the recording is done
        beep(STOP_BEEP_HZ, STOP_BEEP_S).then(function() {
          // Broadcast an event containing the recorded blob
          // This will switch to the playback screen
          element.dispatchEvent(new CustomEvent('record', {
            detail: event.data
          }));

          recordButton.className = '';
        });
      };
      recorder.stop();
      document.querySelector('#lblrecord').textContent = 'Re-record';
      document.querySelector('#playButton').classList.add('active');
      document.querySelector('#uploadButton').classList.add('active');
      document.querySelector('#divanim').className = 'stopped-indicator';
      element.querySelector('#playimg').src = "imgs/Triangle-09-on.png";
      element.querySelector('#submitimg').src = "imgs/CheckMark-on.png";
    }
  }

  // A WebAudio utility to do simple beeps
  function beep(hertz, duration, volume) {
    return new Promise(function(resolve, reject) {
      var beeper = audioContext.createOscillator();
      var startTime = audioContext.currentTime;
      var endTime = startTime + duration;
      beeper.connect(beeperVolume);
      beeper.frequency.value = hertz;
      beeperVolume.gain.value = volume || 0.3 ; // soft by default
      beeper.start();
      beeper.stop(endTime);
      beeper.onended = function() {
        beeper.disconnect();
        resolve();
      };
    });
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
      if (height < 0 )
        continue;

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
        fillStyle = `rgb(${r}, ${g}, ${b})`;
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
      if (recordButton.className === 'disabled')
          return;
      if (recording) {
          stopRecording();
      }
      else {
          startRecording();
      }
  });

  uploadButton.addEventListener('click', function() {
    if (!canuploadandplay)
      return;
    element.dispatchEvent(new CustomEvent('upload', {detail: this.recording}));
  }.bind(this));

  playButton.addEventListener('click', function() {
    if (!canuploadandplay)
          return;
    this.player.play();
  }.bind(this));

// CLOCK!
  var timeBegan = null;
  var timeStopped = null;
  var stoppedDuration = 0;
  var started = null;

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
    var hour = timeElapsed.getUTCHours();
    var min = timeElapsed.getUTCMinutes();
    var sec = timeElapsed.getUTCSeconds();
    var ms = Math.round(timeElapsed.getUTCMilliseconds() / 100);

    document.getElementById("elapsedtime").innerHTML =
        (sec > 9 ? sec : "0" + sec) + "." + ms + 's';
  }

  visualize();
}

