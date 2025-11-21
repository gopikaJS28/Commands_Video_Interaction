import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// --- HELPER: Dynamic Script Loader ---
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src=\"${src}\"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.body.appendChild(script);
  });
};

const Game = () => {
  // --- REFS ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const gameRef = useRef({
    activities: [],
    currentStep: 0,
    gameState: 'IDLE',
    clapCount: 0,
    isProcessingMove: false,
    attempts: 0,
    timerId: null,
    cameraActive: false
  });

  // --- STATE ---
  const [uiFeedback, setUiFeedback] = useState("Initializing Blizz AI...");
  const [score, setScore] = useState(0);
  const [gameReady, setGameReady] = useState(false);
  const [libsLoaded, setLibsLoaded] = useState(false);
  const [error, setError] = useState(null);

  // 1. Load Data & Scripts
  useEffect(() => {
    axios.get('http://127.0.0.1:8000/api/activities/')
      .then(res => {
        gameRef.current.activities = res.data;
      })
      .catch(err => {
        console.warn("Backend not found, using fallback data.");
        gameRef.current.activities = [
          {
            "id": 1,
            "title": "Clap Your Hands",
            "action_type": "CLAP",
            "target_count": 2,
            "intro_text": "Clap your hands twice!",
            "success_text": "Perfect clapping!",
            "retry_text": "I didn't quite catch that. Try clapping louder!",
            "skip_text": "That was tricky! Let's shake it off and try the next one.",
            "time_limit": 5000
          },
          {
            "id": 2,
            "title": "Touch Your Nose",
            "action_type": "NOSE_TOUCH",
            "target_count": 1,
            "intro_text": "Touch your nose!",
            "success_text": "Nice! You found it!",
            "retry_text": "Try again! Point to your nose.",
            "skip_text": "Don't worry, we'll get it next time. Moving on!",
            "time_limit": 5000
          },
          {
            "id": 3,
            "title": "Raise One Hand",
            "action_type": "RAISE_HAND",
            "target_count": 1,
            "intro_text": "All right… last one! Raise one hand up high!",
            "success_text": "Woo-hoo! You nailed all the commands!",
            "retry_text": "I can't see your hand. Try raising it higher!",
            "skip_text": "That was a tough one. You did your best!",
            "time_limit": 6000
          }
        ];
      });

    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/holistic/holistic.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js'
    ];

    Promise.all(scripts.map(loadScript))
      .then(() => {
        setTimeout(() => {
          if (window.Holistic && window.Camera) {
            setLibsLoaded(true);
            setUiFeedback("Click Start to Begin Adventure!");
            setGameReady(true);
          } else {
            setError("AI Libraries loaded but failed to initialize. Please refresh.");
          }
        }, 1000);
      })
      .catch(err => {
        setError("Failed to load AI libraries.");
        console.error(err);
      });

    return () => {
      if (gameRef.current.timerId) clearTimeout(gameRef.current.timerId);
    }
  }, []);

  // 2. Initialize MediaPipe
  useEffect(() => {
    if (!libsLoaded || !videoRef.current) return;

    try {
      const Holistic = window.Holistic;
      const Camera = window.Camera;

      const holistic = new Holistic({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableFaceLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      holistic.onResults(onResults);

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await holistic.send({ image: videoRef.current });
          }
        },
        width: 640,
        height: 480
      });

      camera.start();
      gameRef.current.cameraActive = true;

    } catch (e) {
      console.error("Critical AI Init Error:", e);
      setError("Camera/AI failed to start.");
    }
  }, [libsLoaded]);

  // --- GAME LOGIC ---
  const speak = (text) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  const startGame = () => {
    if (gameRef.current.activities.length === 0) return;
    setScore(0);
    gameRef.current.currentStep = 0;
    playIntro(0);
  };

  const playIntro = (index) => {
    const activity = gameRef.current.activities[index];
    if (!activity) { finishGame(); return; }

    gameRef.current.gameState = 'INTRO';
    gameRef.current.clapCount = 0;
    gameRef.current.attempts = 0;
    gameRef.current.isProcessingMove = false;

    setUiFeedback(activity.intro_text);
    speak(activity.intro_text);

    setTimeout(() => {
      startGameplayLoop();
    }, 4000);
  };

  const startGameplayLoop = () => {
    const activity = gameRef.current.activities[gameRef.current.currentStep];
    if (!activity) return;

    gameRef.current.gameState = 'PLAYING';
    setUiFeedback("GO! " + activity.title);
    startTimer(activity.time_limit || 5000);
  };

  const startTimer = (duration) => {
    if (gameRef.current.timerId) clearTimeout(gameRef.current.timerId);
    gameRef.current.timerId = setTimeout(handleTimeout, duration);
  };

  const handleTimeout = () => {
    const activity = gameRef.current.activities[gameRef.current.currentStep];

    if (gameRef.current.attempts === 0) {
      gameRef.current.attempts = 1;
      gameRef.current.gameState = 'RETRY_WAIT';
      const retryMsg = activity.retry_text || "Try again!";
      speak(retryMsg);
      setUiFeedback(retryMsg);
      setTimeout(() => startGameplayLoop(), 3000);
    } else {
      gameRef.current.gameState = 'SKIP';
      const skipMsg = activity.skip_text || "Let's move on.";
      speak(skipMsg);
      setUiFeedback("Skipping...");
      setTimeout(() => loadNextLevel(), 4000);
    }
  };

  const handleSuccess = () => {
    if (gameRef.current.timerId) clearTimeout(gameRef.current.timerId);
    const activity = gameRef.current.activities[gameRef.current.currentStep];

    if (gameRef.current.gameState === 'SUCCESS') return;
    gameRef.current.gameState = 'SUCCESS';

    speak(activity.success_text);
    setUiFeedback("GREAT JOB!");
    setScore(s => s + 10);
    setTimeout(() => loadNextLevel(), 4000);
  };

  const loadNextLevel = () => {
    const nextStep = gameRef.current.currentStep + 1;
    if (nextStep < gameRef.current.activities.length) {
      gameRef.current.currentStep = nextStep;
      playIntro(nextStep);
    } else {
      finishGame();
    }
  };

  const finishGame = () => {
    gameRef.current.gameState = 'FINISHED';
    setUiFeedback("MISSION COMPLETE!");
    speak("Fantastic command-following, Explorer. You were amazing!");
  };

  // --- AI LOOP ---
  const onResults = (results) => {
    const activity = gameRef.current.activities[gameRef.current.currentStep];
    const currentAction = activity ? activity.action_type : null;

    // Draw First
    drawSkeleton(results, currentAction);

    if (gameRef.current.gameState !== 'PLAYING' || !results.poseLandmarks) return;
    const landmarks = results.poseLandmarks;

    // Check Proximity (If shoulders are too wide apart, user is too close)
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderDist = Math.abs(leftShoulder.x - rightShoulder.x);
    if (shoulderDist > 0.8) {
      // Don't block the game, but give visual hint
      setUiFeedback("Take a small step back!");
    }

    // 1. CLAP
    if (currentAction === 'CLAP') {
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const dist = Math.hypot(leftWrist.x - rightWrist.x, leftWrist.y - rightWrist.y);

      if (dist < 0.15 && !gameRef.current.isProcessingMove) {
        gameRef.current.isProcessingMove = true;
        gameRef.current.clapCount += 1;
        setUiFeedback(`Claps: ${gameRef.current.clapCount} / ${activity.target_count}`);
        if (gameRef.current.clapCount >= activity.target_count) handleSuccess();
        setTimeout(() => { gameRef.current.isProcessingMove = false; }, 500);
      }
    }

    // 2. NOSE (wrist-based detection)
    // Helper: check if a wrist is near the nose within X/Y tolerances
    // Extended to require a "hand near nose" pose: the elbow should be above the wrist
    // Signature: checkTouch(wrist, nose, elbow, xTol, yTol, noseVis)
    const checkTouch = (wrist, nose, elbow, xTol = 0.15, yTol = 0.08, noseVis = 1) => {
      if (!wrist || !nose) return false;
      // If the model reports low nose visibility, ignore
      if (noseVis !== undefined && noseVis < 0.3) return false;

      const yClose = Math.abs(wrist.y - nose.y) <= yTol;
      const xClose = Math.abs(wrist.x - nose.x) <= xTol;

      // Require elbow to be above the wrist (arm bent up toward face) when available
      let elbowAbove = true;
      if (elbow) elbowAbove = elbow.y < wrist.y;

      return xClose && yClose && elbowAbove;
    };

    if (currentAction === 'NOSE_TOUCH') {
      // Use MediaPipe face landmarks (face mesh) for precise nose tip
      if (!results.faceLandmarks || results.faceLandmarks.length === 0) return;

      // nose tip candidates: 1 or 4 (face mesh indexing can vary by version); prefer 1 then 4
      const faceNose = results.faceLandmarks[1] || results.faceLandmarks[4];
      if (!faceNose) return;

      const leftHand = results.leftHandLandmarks;
      const rightHand = results.rightHandLandmarks;

      const checkTouchFace = (handLandmarks) => {
        if (!handLandmarks || !handLandmarks.length) return false;
        const indexTip = handLandmarks[8];
        if (!indexTip) return false;
        const dx = indexTip.x - faceNose.x;
        const dy = indexTip.y - faceNose.y;
        const dist = Math.hypot(dx, dy);
        return dist < 0.05; // tight threshold using face mesh
      };

      const now = Date.now();
      const last = gameRef.current.lastNoseTouchAt || 0;
      const debounceMs = 1500;

      const leftHit = checkTouchFace(leftHand);
      const rightHit = checkTouchFace(rightHand);

      if (leftHit || rightHit) {
        gameRef.current.noseTouchStreak = (gameRef.current.noseTouchStreak || 0) + 1;
      } else {
        gameRef.current.noseTouchStreak = 0;
      }

      if ((gameRef.current.noseTouchStreak >= 3) && (now - last > debounceMs)) {
        gameRef.current.lastNoseTouchAt = now;
        gameRef.current.noseTouchStreak = 0;
        handleSuccess();
      }
    }

    // 3. RAISE HAND
    if (currentAction === 'RAISE_HAND') {
      const nose = landmarks[0];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      if (leftWrist.y < nose.y || rightWrist.y < nose.y) handleSuccess();
    }
  };

  // --- DRAWING ---
  const drawSkeleton = (results, actionType) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // CRITICAL FIX: Use the DISPLAY size of the video element, not the internal resolution.
    // This ensures 1:1 alignment even if the video is being squashed/stretched by CSS.
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const ctx = canvas.getContext('2d');
    const drawConnectors = window.drawConnectors;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mirror Effect
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    if (!results.poseLandmarks) { ctx.restore(); return; }

    const drawPoint = (lm, color) => {
      if (lm) {
        ctx.beginPath();
        ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 8, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    // Visuals Logic
    if (actionType === 'CLAP') {
      // CLAP: detection runs silently, no visual overlay
      // const armConnections = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12]];
      // if (drawConnectors) drawConnectors(ctx, results.poseLandmarks, armConnections, { color: '#00FF00', lineWidth: 4 });
      // drawPoint(results.poseLandmarks[15], '#FFFF00');
      // drawPoint(results.poseLandmarks[16], '#FFFF00');
    }
    else if (actionType === 'NOSE_TOUCH') {
      // NOSE_TOUCH: detection runs silently, no visual overlay
      // drawPoint(results.poseLandmarks[0], '#FF0000');
      // if (results.leftHandLandmarks && results.leftHandLandmarks.length) {
      //   const lm = results.leftHandLandmarks;
      //   [4,8,12,16,20].forEach(i => { if (lm[i]) drawPoint({ x: lm[i].x, y: lm[i].y }, '#00FF00'); });
      // }
      // if (results.rightHandLandmarks && results.rightHandLandmarks.length) {
      //   const lm = results.rightHandLandmarks;
      //   [4,8,12,16,20].forEach(i => { if (lm[i]) drawPoint({ x: lm[i].x, y: lm[i].y }, '#00FF00'); });
      // }
      // if (results.poseLandmarks[19]) drawPoint(results.poseLandmarks[19], '#00FF00');
      // if (results.poseLandmarks[20]) drawPoint(results.poseLandmarks[20], '#00FF00');
    }
    else if (actionType === 'RAISE_HAND') {
      // RAISE_HAND: detection runs silently, no visual overlay
      // const upperBody = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24]];
      // if (drawConnectors) drawConnectors(ctx, results.poseLandmarks, upperBody, { color: '#00FFFF', lineWidth: 4 });
      // drawPoint(results.poseLandmarks[0], '#FF0000');
      // drawPoint(results.poseLandmarks[15], '#FFFF00');
      // drawPoint(results.poseLandmarks[16], '#FFFF00');
    }
    else {
      for (let i = 0; i < 11; i++) drawPoint(results.poseLandmarks[i], 'rgba(255,255,255,0.5)');
    }
    ctx.restore();
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Blizz & Suki's Adventure 🐾</h1>

      <div style={styles.gameWindow}>
        <video ref={videoRef} style={styles.videoLayer} autoPlay playsInline muted />
        <canvas ref={canvasRef} style={styles.layer} />

        <div style={styles.overlay}>
          <h2 style={styles.overlayText}>{uiFeedback}</h2>
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.controls}>
        <h2 style={{ color: '#333' }}>Score: {score}</h2>
        {gameReady && !error && (
          <button onClick={startGame} style={styles.button}>
            ▶ START GAME
          </button>
        )}
        {!gameReady && !error && <p>Loading Magic Camera...</p>}
      </div>
    </div>
  );
};

const styles = {
  container: { textAlign: 'center', fontFamily: "'Comic Sans MS', sans-serif", backgroundColor: '#f0f8ff', minHeight: '100vh', padding: '20px' },
  title: { color: '#2c3e50', marginBottom: '20px' },
  gameWindow: {
    position: 'relative',
    width: '640px',
    height: '480px',
    margin: '0 auto',
    backgroundColor: '#000',
    borderRadius: '15px',
    overflow: 'hidden',
    boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
  },
  videoLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    objectFit: 'fill', // Ensures video matches container exactly, eliminating alignment gaps
    transform: 'scaleX(-1)'
  },
  layer: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    bottom: '20px',
    left: '0',
    right: '0',
    display: 'flex',
    justifyContent: 'center',
    zIndex: 10
  },
  overlayText: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
    padding: '10px 30px',
    borderRadius: '20px',
    fontSize: '1.5rem',
    transition: 'all 0.3s ease'
  },
  error: {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    color: 'red', background: 'white', padding: '20px', borderRadius: '10px'
  },
  controls: { marginTop: '20px' },
  button: {
    padding: '15px 30px',
    fontSize: '1.2rem',
    backgroundColor: '#e67e22',
    color: 'white',
    border: 'none',
    borderRadius: '50px',
    cursor: 'pointer',
    fontWeight: 'bold',
    boxShadow: '0 5px 0 #d35400'
  }
};

export default Game;