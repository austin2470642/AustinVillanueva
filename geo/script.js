const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const context = overlay.getContext('2d');
const startButton = document.getElementById('startBtn');
const stopButton = document.getElementById('stopBtn');
const confidenceInput = document.getElementById('confidenceInput');
const confidenceValue = document.getElementById('confidenceValue');
const liveLabel = document.getElementById('liveLabel');
const gestureScore = document.getElementById('gestureScore');
const letterOutput = document.getElementById('letterOutput');
const handStatus = document.getElementById('handStatus');
const modelLabelOutput = document.getElementById('modelLabelOutput');
const wordOutput = document.getElementById('wordOutput');
const addLetterButton = document.getElementById('addLetterBtn');
const status = document.getElementById('status');
const errorBox = document.getElementById('error');

let model;
let modelLoading;
let cameraStream;
let frameRequest;
let isDetecting = false;
let currentLetter = '';
let spelledWord = '';

function setStatus(message) {
	status.textContent = message;
}

function showError(message) {
	errorBox.textContent = message;
	errorBox.classList.add('show');
}

function clearError() {
	errorBox.textContent = '';
	errorBox.classList.remove('show');
}

function clearRecognition(message = 'The current handshape will appear here.') {
	context.clearRect(0, 0, overlay.width, overlay.height);
	letterOutput.textContent = '-';
	gestureScore.textContent = '-';
	handStatus.textContent = 'No hand detected.';
	modelLabelOutput.textContent = '-';
	addLetterButton.disabled = true;
	if (message) setStatus(message);
}

async function loadModel() {
	if (model) return model;
	if (!modelLoading) {
		modelLoading = (async () => {
			setStatus('Loading the hand sign model...');
			const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14');
			const files = await vision.FilesetResolver.forVisionTasks(
				'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
			);
			const options = {
				baseOptions: {
					modelAssetPath: 'https://huggingface.co/EvSz/ASLAlphabet/resolve/main/gesture_recognizer.task',
					delegate: 'GPU'
				},
				runningMode: 'VIDEO',
				numHands: 1
			};
			try {
				model = await vision.GestureRecognizer.createFromOptions(files, options);
			} catch {
				options.baseOptions.delegate = 'CPU';
				model = await vision.GestureRecognizer.createFromOptions(files, options);
			}
			return model;
		})().catch(error => {
			modelLoading = undefined;
			throw new Error(`Could not load the sign model. Check your internet connection and try again. ${error.message}`);
		});
	}
	return modelLoading;
}

function setSourceVisible(source) {
	video.classList.toggle('visible', source === video);
}

const handConnections = [
	[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [5, 9, 10, 11, 12],
	[9, 13, 14, 15, 16], [13, 17, 18, 19, 20], [0, 17],
	[5, 9], [9, 13], [13, 17]
];

function drawHand(landmarks, width, height) {
	if (overlay.width !== width || overlay.height !== height) {
		overlay.width = width;
		overlay.height = height;
	}
	context.clearRect(0, 0, width, height);
	if (!landmarks) return;

	context.strokeStyle = '#c9f36b';
	context.fillStyle = '#fffefa';
	context.lineWidth = Math.max(2, width / 360);
	context.lineCap = 'round';
	handConnections.forEach(points => {
		context.beginPath();
		points.forEach((index, position) => {
			const point = landmarks[index];
			const x = point.x * width;
			const y = point.y * height;
			if (position === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		});
		context.stroke();
	});
	landmarks.forEach(point => {
		context.beginPath();
		context.arc(point.x * width, point.y * height, Math.max(3, width / 180), 0, Math.PI * 2);
		context.fill();
		context.stroke();
	});
}

function renderRecognition(result) {
	const width = video.videoWidth;
	const height = video.videoHeight;
	if (!width || !height) return;
	const landmarks = result.landmarks[0];
	drawHand(landmarks, width, height);
	handStatus.textContent = landmarks?.length ? 'Hand detected.' : 'No hand detected.';

	const category = result.gestures[0]?.[0];
	const confidence = category?.score ?? 0;
	const label = category?.categoryName?.trim();
	modelLabelOutput.textContent = label || '-';
	const recognized = /^[A-Z]$/i.test(label || '') && confidence >= Number(confidenceInput.value) / 100;
	if (!recognized) {
		currentLetter = '';
		letterOutput.textContent = '-';
		gestureScore.textContent = '-';
		addLetterButton.disabled = true;
		setStatus(landmarks?.length
			? `Hand detected. Model result: ${label || 'no label'} (${Math.round(confidence * 100)}%). Hold a clear ASL letter.`
			: 'No hand detected. Show one hand clearly to the camera.');
		return;
	}

	currentLetter = label.toUpperCase();
	letterOutput.textContent = currentLetter;
	gestureScore.textContent = `${Math.round(confidence * 100)}%`;
	addLetterButton.disabled = false;
	setStatus('Letter recognized. Press Add letter to spell it.');
}

async function detectCameraFrame() {
	if (!cameraStream) return;
	if (!isDetecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
		isDetecting = true;
		try {
			const recognizer = await loadModel();
			const result = recognizer.recognizeForVideo(video, performance.now());
			renderRecognition(result);
		} catch (error) {
			showError(`Detection failed: ${error.message}`);
			setStatus('Recognition failed.');
			stopCamera();
			return;
		} finally {
			isDetecting = false;
		}
	}
	if (cameraStream) frameRequest = requestAnimationFrame(detectCameraFrame);
}

function stopCamera() {
	if (frameRequest) cancelAnimationFrame(frameRequest);
	frameRequest = undefined;
	if (cameraStream) {
		cameraStream.getTracks().forEach(track => track.stop());
		cameraStream = undefined;
	}
	video.srcObject = null;
	video.classList.remove('visible');
	stopButton.hidden = true;
	startButton.hidden = false;
	liveLabel.textContent = 'Camera is off.';
}

async function startCamera() {
	clearError();
	startButton.disabled = true;
	try {
		await loadModel();
		setStatus('Model ready. Requesting camera access...');
		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('Camera access needs a secure page. Open this page using HTTPS or localhost.');
		}
		cameraStream = await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } }
		});
		video.srcObject = cameraStream;
		await video.play();
		setSourceVisible(video);
		stopButton.hidden = false;
		startButton.hidden = true;
		liveLabel.textContent = 'Camera is on.';
		setStatus('Show one hand to the camera.');
		frameRequest = requestAnimationFrame(detectCameraFrame);
	} catch (error) {
		stopCamera();
		showError(error.name === 'NotAllowedError'
			? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
			: error.message || 'Could not start the camera. Check browser permissions and try again.');
		setStatus('Camera did not start.');
	} finally {
		startButton.disabled = false;
	}
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', () => {
	stopCamera();
	setSourceVisible(null);
	clearRecognition('Camera stopped.');
	setStatus('Camera stopped.');
});
confidenceInput.addEventListener('input', () => {
	confidenceValue.value = `${confidenceInput.value}%`;
});
addLetterButton.addEventListener('click', () => {
	if (!currentLetter) return;
	spelledWord += currentLetter;
	wordOutput.textContent = spelledWord;
});
document.getElementById('spaceBtn').addEventListener('click', () => {
	if (!spelledWord || spelledWord.endsWith(' ')) return;
	spelledWord += ' ';
	wordOutput.textContent = spelledWord;
});
document.getElementById('backspaceBtn').addEventListener('click', () => {
	spelledWord = spelledWord.slice(0, -1);
	wordOutput.textContent = spelledWord;
});
document.getElementById('clearWordBtn').addEventListener('click', () => {
	spelledWord = '';
	wordOutput.textContent = spelledWord;
});
