var segmentMap = SegmentMap;
var bv = bandersnatch.videos['80988062'].interactiveVideoMoments.value;
var choicePoints = bv.choicePointNavigatorMetadata.choicePointsMetadata.choicePoints;
var momentsBySegment = bv.momentsBySegment;
var segmentGroups = bv.segmentGroups;
var captions = {};
var currentSegment;
var currentMoment;
var nextSegment = null;
var momentSelected = null;
var persistentState = bv.stateHistory;
var globalChoices = {};

function msToString(ms) {
	return new Date(ms).toUTCString().split(' ')[4];
}

function getCurrentMs() {
	return Math.round(document.getElementById("video").currentTime * 1000.0);
}

function generateJs(cond) {
	if (cond[0] == 'persistentState') {
		return '!!persistentState["' + cond[1] + '"]';
	} else if (cond[0] == 'not') {
		return '!(' + generateJs(cond[1]) + ')';
	} else if (cond[0] == 'and') {
		var conds = [];
		for (var i = 1; i < cond.length; i++) {
			conds.push('(' + generateJs(cond[i]) + ')');
		}
		return '(' + conds.join(' && ') + ')';
	} else if (cond[0] == 'or') {
		var conds = [];
		for (var i = 1; i < cond.length; i++) {
			conds.push('(' + generateJs(cond[i]) + ')');
		}
		return '(' + conds.join(' || ') + ')';
	} else {
		console.log('unsupported condition!', cond);
		return 'true';
	}
}

function checkPrecondition(segmentId) {
	let precondition = bv.preconditions[segmentId];

	if (precondition) {
		let cond = generateJs(precondition);
		let match = eval(cond);

		console.log(cond, '==', match);

		return match;
	}

	return true;
}

function findSegment(id) {
	if (id.startsWith('nsg-')) {
		id = id.substr(4);
	}
	if (SegmentMap.segments[id]) {
		// check precondition
		return id;
	}

	if (segmentGroups[id]) {
		for (v of segmentGroups[id]) {
			if (v.segmentGroup) {
				return findSegment(v.segmentGroup);
			} else if (v.segment) {
				// check precondition
				return v.segment;
			} else {
				if (checkPrecondition(v))
					return v;
			}
		}
	}
	return id;
}

function getChoiceMs(choiceId) {
	var segmentId = findSegment(choiceId);
	return getSegmentMs(segmentId);
}

function getSegmentId(ms) {
	for (const [k, v] of Object.entries(SegmentMap.segments)) {
		if (ms >= v.startTimeMs && ms < v.endTimeMs) {
			return k;
		}
	}
	return null;
}

function getSegmentMs(segmentId) {
	return segmentMap.segments[segmentId].startTimeMs;
}

function getMoment(ms) {
	for (const [k, v] of Object.entries(momentsBySegment)) {
		for (r of v)
			if (r.type == 'scene:cs_bs') {
				if (ms >= r.startMs && ms < r.endMs) {
					return r;
				}
			}
	}
	return null;
}

function newList(id) {
	var ul = document.getElementById(id);
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}
	return ul;
}

function addItem(ul, text, url) {
	var li = document.createElement("li");
	var a = document.createElement("a");
	a.textContent = text;
	a.setAttribute('href', url);
	li.appendChild(a);
	ul.appendChild(li);
}

function setNextSegment(segmentId, comment) {
	console.log('setNextSegment', segmentId, comment);
	nextSegment = segmentId;
	var ul = newList("nextSegment");
	var caption = 'nextSegment: ' + segmentId;
	addItem(ul, comment ? caption + ' (' + comment + ')' : caption,
		'javascript:playSegment("' + segmentId + '")');
}

function addZones(segmentId) {
	var ul = newList("interactionZones");
	var caption = 'currentSegment(' + segmentId + ')';
	addItem(ul, caption, 'javascript:playSegment("' + segmentId + '")');

	var v = segmentMap.segments[segmentId];
	if (v && v.ui && v.ui.interactionZones) {
		var index = 0;
		for (z of v.ui.interactionZones) {
			var startMs = z[0];
			var stopMs = z[1];
			var caption = segmentId + ' interactionZone ' + index;
			addItem(ul, caption, 'javascript:seek(' + startMs + ')');
			index++;
		}
	}

	var ul = newList("nextSegments");
	for (const [k, v] of Object.entries(segmentMap.segments[segmentId].next)) {
		var caption = captions[k] ? captions[k] : k;
		if (segmentMap.segments[segmentId].defaultNext == k) {
			caption = '[' + caption + ']';
			setNextSegment(k);
		}
		addItem(ul, caption, 'javascript:playSegment("' + k + '")');
	}
}

function addChoices(r) {
	var ul = newList("choices");
	document.getElementById("choiceCaption").innerHTML = '';
	if (!r) return;
	index = 0;

	for (x of r.choices) {
		console.log(x.id, 'choice saved');
		globalChoices[x.id] = x;

		var caption = r.defaultChoiceIndex == index ? '[' + x.text + ']' : x.text;
		addItem(ul, caption, 'javascript:choice("' +
			(x.segmentId ? x.segmentId : (x.sg ? x.sg : x.id)) + '", "' + x.text + '", "' + x.id + '")');
		index++;
	}

	document.getElementById("choiceCaption").innerHTML = choicePoints[r.id].description;
}


function updateProgressBar(ms, r) {
	var p = 0;

	if (r && ms > r.startMs && ms < r.endMs) {
		p = 100 - Math.floor((ms - r.startMs) * 100 / (r.endMs - r.startMs));
	}

	document.getElementById("progress").style.width = p + '%';
}

var timerId = 0;

var switchFrom = null;
var switchTo = null;

function ontimeout(nextSegment) {
	console.log('ontimeout', nextSegment);

	if (switchFrom != currentSegment || switchTo != nextSegment) {
		playSegment(nextSegment);
	}

	switchFrom = currentSegment;
	switchTo = nextSegment;
}

function ontimeupdate(evt) {
	var ms = getCurrentMs();

	var segmentId = getSegmentId(ms);

	// ontimeupdate resolution is about a second, better use timer
	clearTimeout(timerId);
	if (segmentId && nextSegment && nextSegment != segmentId) {
		var timeLeft = SegmentMap.segments[segmentId].endTimeMs - ms;
		timerId = setTimeout(ontimeout, timeLeft, nextSegment);
	}

	if (currentSegment != segmentId) {
		console.log('ontimeupdate', currentSegment, segmentId, ms, msToString(ms));
		currentSegment = segmentId;
		addZones(segmentId);
		currentMoment = null;
		addChoices(0);
	}

	var r = getMoment(ms);
	if (r && momentSelected != r.id) {
		updateProgressBar(ms, r);
		if (currentMoment != r.id) {
			currentMoment = r.id;
			console.log('interaction', currentMoment);
			addChoices(r);
		}
	} else {
		currentMoment = null;
		addChoices(0);
		updateProgressBar(0);
	}
}

function jumpForward(ms) {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);
	var v = segmentMap.segments[segmentId];

	var interactionMs = 0;
	if (v && v.ui && v.ui.interactionZones) {
		for (z of v.ui.interactionZones) {
			var startMs = z[0];
			var stopMs = z[1];
			if (ms < startMs)
				interactionMs = startMs;
		}
	}

	if (interactionMs) {
		seek(interactionMs);
	} else {
		playSegment(nextSegment);
	}
}

function jumpBack() {
	var ms = getCurrentMs();
	var segmentId = getSegmentId(ms);
	var startMs = getSegmentMs(segmentId);
	var previousSegment = getSegmentId(startMs - 1000);
	console.log('jumpBack from-to', segmentId, previousSegment);
	playSegment(previousSegment);
}

function toggleFullScreen() {
	console.log('toggleFullScreen');
	var c = document.getElementById("c");
	if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
		if (c.requestFullscreen) {
			c.requestFullscreen();
		} else if (c.msRequestFullscreen) {
			c.msRequestFullscreen();
		} else if (c.mozRequestFullScreen) {
			c.mozRequestFullScreen();
		} else if (c.webkitRequestFullscreen) {
			c.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
		}
	} else {
		if (document.exitFullscreen) {
			document.exitFullscreen();
		} else if (document.msExitFullscreen) {
			document.msExitFullscreen();
		} else if (document.mozCancelFullScreen) {
			document.mozCancelFullScreen();
		} else if (document.webkitExitFullscreen) {
			document.webkitExitFullscreen();
		}
	}
}

function togglePlayPause() {
	var v = document.getElementById("video");
	if (v.paused) v.play();
	else v.pause();
}

function onload() {
	var video_selector = document.getElementById("video");
	var video_source_selector = document.getElementById("video-source");
	var file_selector = document.getElementById("file-selector");
	if (video_source_selector.getAttribute("src") == '') {
		console.log('no video')
		file_selector.style.display = 'table';
		document.getElementById("wrapper-video").style.display = 'none';
	}
	document.getElementById('fileinput').addEventListener('change', function () {
		var file = this.files[0];
		var fileUrl =  URL.createObjectURL(file)
		video_selector.src = fileUrl;
		video_selector.play();
		file_selector.style.display = 'none';
		document.getElementById("wrapper-video").style.display = 'block';
	}, false);

	video_selector.ontimeupdate = ontimeupdate;

	var c = document.getElementById("c");
	c.ondblclick = toggleFullScreen;
	c.onclick = function () {
		// can't togglePlayPause here, choice buttons stop the video
		// should use preventdefault or something
		// use spacebar for now
		// mind that autoplay is disabled in latest chrome, so play after click
		document.getElementById("video").play();
	};

	document.onkeypress = function (e) {
		if (e.code == 'KeyF')
			toggleFullScreen();
		if (e.code == 'KeyR')
			playSegment(0);
		if (e.code == 'Space')
			togglePlayPause();
	}

	document.onkeydown = function (evt) {
		var v = document.getElementById("video");

		if (evt.key == 'ArrowLeft') {
			jumpBack();
		}

		if (evt.key == 'ArrowRight') {
			jumpForward();
		}
	}

	if (location.hash) {
		var segmentId = location.hash.slice(1);
		playSegment(segmentId);
	}

}

function seek(ms) {
	clearTimeout(timerId);
	console.log('seek', ms);
	momentSelected = null;
	document.getElementById("video").currentTime = ms / 1000.0;
}

function choice(choiceId, text, id) {
	var segmentId = findSegment(choiceId);
	console.log('choice', choiceId, 'nextSegment', segmentId);
	applyImpression(globalChoices[id]);
	setNextSegment(segmentId, text);
	momentSelected = choiceId;
	addChoices(0);
}

function applyImpression(obj) {
	if (!obj) {
		return;
	}

	impressionData = obj.impressionData;

	if (impressionData && impressionData.type == 'userState') {
		for (const [variable, value] of Object.entries(impressionData.data.persistent)) {
			console.log('persistentState set', variable, '=', value);
			persistentState[variable] = value;
		}
	}
}

function applyPlaybackImpression(segmentId) {
	let moments = momentsBySegment[segmentId];

	if (!moments) {
		console.log('warning - no moments');
		return;
	}

	for (moment of moments) {
		if (moment.type != 'notification:playbackImpression') {
			continue;
		}

		applyImpression(moment);
	}
}

function playSegment(segmentId) {
	clearTimeout(timerId);
	if (!segmentId || segmentId == "undefined")
		segmentId = '1A';
	console.log('playSegment', segmentId);
	applyPlaybackImpression(segmentId);
	location.hash = segmentId;
	document.title = 'Bandersnatch - Chapter ' + segmentId;
	var ms = getSegmentMs(segmentId);
	seek(ms);
}