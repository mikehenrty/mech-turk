let $ = document.querySelector.bind(document);
let SOUNDCLIP_URL = '/upload/';

function getQuery() {
  if (window._query) {
    return window._query;
  }
  let query = location.search.substr(1);
  let result = {};
  query.split("&").forEach(function(part) {
    let item = part.split("=");
    result[item[0]] = decodeURIComponent(item[1]);
  });
  window._query = result;
  return result;
}

function setMessage(message) {
  let m = $('#message');
  m.textContent = message;
  m.className = 'panel';
}

function getRadios() {
  return document.querySelectorAll('input[type="radio"]');
}

function getCheckedRadios() {
  return document.querySelectorAll('input[type="radio"]:checked');
}

function isFormReady() {
  return getCheckedRadios().length > 0;
}

function validateForm() {
  if (isFormReady()) {
    $('#submit-btn').className = 'active';
    return true;
  }

  $('#submit-btn').className = '';
  return false;
}


function checkForm() {
  if (!validateForm()) {
    setMessage('Must listen and select a value to submit.');
    return false;
  }

  let f = $('form');
  f.submit();
  return true;
}

function onLoad() {
  let query = getQuery();

  if (query.assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
    return;
  }

  let clip = document.getElementById('clip');
  clip.src = SOUNDCLIP_URL + query.previousworkerid + '/' +  query.verifyid;

  $('#original-excerpt').textContent = `"${query.excerpt}"`;
  $('[name=previousworkerid]').value = query.previousworkerid;
  $('[name=previousassignmentid]').value = query.verifyid;
  $('[name=assignmentId]').value = query.assignmentId;

  let m = $('#message');
  m.className = 'panel disabled';
  let o = $('#overlay');
  o.className = 'disabled';
  let s = $('#submit-btn');
  s.addEventListener('click', checkForm);

  let r = getRadios();
  for (let i = 0; i < r.length; i++) {
    r[i].onclick = validateForm;
  }
}

document.addEventListener('DOMContentLoaded', onLoad);
