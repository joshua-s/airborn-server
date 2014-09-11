function GET(url, callback) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4 && req.status === 200) {
			callback(req.responseText);
		}
	};
	req.open('GET', url);
	req.send(null);
}

function POST(url, data, success, error) {
	var req = new XMLHttpRequest();
	req.onreadystatechange = function() {
		if(req.readyState === 4)
			if(req.status === 200) {
				success(req.responseText);
			} else {
				error(req);
			}
	};
	req.open('POST', url);
	req.setRequestHeader('Content-Type', 'application/json');
	req.send(JSON.stringify(data));
}

var lang = {};
GET('lang.json', function(response) {
	var strings = lang = JSON.parse(response);
	document.getElementById('username-label').textContent = strings.username;
	document.getElementById('password-label').textContent = strings.password;
	document.getElementById('password-again-label').textContent = strings['password-again'];
	document.getElementById('notify-of-updates-label').textContent = strings['notify-of-updates'];
	document.getElementById('captcha-label').textContent = strings.captcha;
	document.getElementById('ready').textContent = strings.ready;
	document.getElementById('register').value = strings.register;
	document.getElementById('repair').textContent = strings.repair;
	document.getElementById('contact').textContent = strings.contact;
});

var captcha;
document.addEventListener('DOMContentLoaded', function() {
	captcha = visualCaptcha('captcha', {
		numberOfImages: 5,
		imgPath: '/3rdparty/visualcaptcha/img/',
		captcha: {
			url: '/captcha'
		}
	});
	this.addEventListener('click', function(evt) {
		var elm = evt.target;
		if(evt.target.tagName === 'IMG') {
			elm = elm.parentElement;
		}
		if(elm.classList.contains('img')) {
			maybeReady();
		} else if(elm.classList.contains('visualCaptcha-refresh-button')) {
			document.getElementById('ready').style.display = 'none';
		}
	});
	this.addEventListener('keypress', function(evt) {
		var elm = evt.target;
		if(evt.target.tagName === 'IMG') {
			elm = elm.parentElement;
		}
		if((elm.classList.contains('img') || elm.classList.contains('visualCaptcha-refresh-button') || elm.classList.contains('visualCaptcha-accessibility-button')) &&
		   (evt.which === 13 || evt.which === 32)) {
			elm.click();
		}
	});
	function debounce(fn, time, obj) {
		if(obj.timeout) clearTimeout(obj.timeout);
		obj.timeout = setTimeout(function() {
			delete obj.timeout;
			fn();
		}, time);
	}
	var debounceObj = {};
	this.addEventListener('keyup', function(evt) {
		debounce(maybeReady, 500, debounceObj);
	});
	function maybeReady() {
		if(document.getElementById('username').value) {
			document.getElementById('error').style.display = 'none';
			GET('/user/' + document.getElementById('username').value + '/exists', function(response) {
				if(response === 'true') {
					document.getElementById('error').textContent = lang.taken;
					document.getElementById('error').style.display = 'inline-block';
					return;
				}
				var error = maybeError();
				if(!error) {
					document.getElementById('ready').style.display = 'inline-block';
				} else if(error === lang.diffpasswords) {
					document.getElementById('error').textContent = lang.diffpasswords;
					document.getElementById('error').style.display = 'inline-block';
					document.getElementById('ready').style.display = 'none';
				}
			});
		}
	}
});

function maybeError() {
	if(
		!document.getElementById('username').value ||
		!document.getElementById('password').value ||
		!document.getElementById('password-again').value
	) {
		return lang.nofield;
	}
	if(document.getElementById('password').value !== document.getElementById('password-again').value) {
		return lang.diffpasswords;
	}
	if(!captcha.getCaptchaData().valid) {
		return lang.nocaptcha;
	}
}

document.getElementById('container').addEventListener('submit', function(evt) {
	evt.preventDefault();
	var error = maybeError();
	if(error) {
		alert(error);
		return;
	}
	document.getElementById('ready').style.display = 'none';
	var register = document.getElementById('register');
	register.disabled = true;
	register.value = lang.validating;
	var data = {};
	Array.prototype.forEach.call(document.getElementById('captcha').getElementsByTagName('input'), function(input) {
		data[input.name] = input.value;
	});
	var username = window.username = document.getElementById('username').value;
	var password = window.password = document.getElementById('password').value;
	var notifyOfUpdates = document.getElementById('notify-of-updates').checked;
	POST('/captcha/try', data, function() {
		register.value = lang.registering;
		try {
			var salt = sjcl.random.randomWords(2);
			var files_key = window.files_key = sjcl.random.randomWords(8);
			var hmac_bits = sjcl.random.randomWords(4);
		} catch(e) {
			alert(lang.error);
			throw e;
		}
		var key = sjcl.misc.pbkdf2(password, salt, 1000);
		var private_key = window.private_key = key.slice(128/32); // Second half
		var shared_key = key.slice(0, 128/32); // First half
		var private_hmac = window.private_hmac = new sjcl.misc.hmac(private_key);
		var files_hmac = window.files_hmac = new sjcl.misc.hmac(hmac_bits);
		var authkey = sjcl.codec.hex.fromBits(shared_key).toUpperCase();
		
		POST('/register', {
			username: username,
			salt: sjcl.codec.hex.fromBits(salt).toUpperCase(),
			authkey: authkey
		}, function(response) {
			register.value = lang.uploading;
			JSZipUtils.getBinaryContent('http://airborn-update-stage.herokuapp.com/current', function(err, data) {
				if(err) {
					register.disabled = false;
					register.value = lang.register;
					alert(lang.error);
					return;
				}
				
				var zip = new JSZip(data);

				var getFile = function(file, options, callback) {
					console.log([].slice.call(arguments));
					if(window.getFileCache[file]) {
						return window.getFile(file, options, callback);
					}
					if(typeof options === 'function') {
						callback = options;
						options = {};
					}
					if(file.substr(0, 6) === '/Core/' && file.substr(-1) !== '/' && zip.files['airborn/' + file.substr(6)]) {
						callback(zip.files['airborn/' + file.substr(6)].asText());
					} else {
						callback(null);
					}
				};
				var openWindow = function() {};
				eval(zip.files['airborn/core.js'].asText());

				var keys = Object.keys(zip.folder('airborn').files);
				var uploaded = 0;
				var total = 0;
				var target = '/Core/';
				console.time('upload core');
				keys.forEach(function(path) {
					var file = zip.files[path];
					if(!file.options.dir) {
						total++;
						putFile(target + path.replace(/^airborn\//, ''), {codec: 'arrayBuffer'}, file.asArrayBuffer(), function() {
							uploaded++;
							if(uploaded === total) cont();
						});
					}
				});
				total += 3;
				putFile('/key', sjcl.codec.hex.fromBits(files_key).toUpperCase(), function() {
					uploaded++;
					if(uploaded === total) cont();
				});
				putFile('/hmac', sjcl.codec.hex.fromBits(hmac_bits).toUpperCase(), function() {
					uploaded++;
					if(uploaded === total) cont();
				});
				putFile('/settings', {codec: 'prettyjson'}, {core: {notifyOfUpdates: notifyOfUpdates}}, function() {
					uploaded++;
					if(uploaded === total) cont();
				});
				function cont() {
					console.timeEnd('upload core');
					corsReq('http://marketplace-dev.airborn.io/api/v1/apps/app/marketplace/', function() {
						console.time('upload marketplace');
						installPackage(this.response.manifest_url, {categories: this.response.categories}, function() {
							console.timeEnd('upload marketplace');
							document.getElementById('container').innerHTML = lang.done + ' ' + '<a href="/">' + lang.login + '</a>';
						});
					}, 'json');
				}
			});
		}, function(req) {
			register.disabled = false;
			register.value = lang.register;
			if(req.status === 409) {
				alert(lang.taken);
			} else {
				alert(lang.error);
			}
		});
	}, function(req) {
		register.disabled = false;
		register.value = lang.register;
		if(req.status === 403) {
			alert(lang.wrong);
		} else {
			alert(lang.error);
		}
		captcha.refresh();
	});
});