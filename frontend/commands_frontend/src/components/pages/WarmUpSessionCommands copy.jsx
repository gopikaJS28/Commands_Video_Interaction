import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConversation } from '@elevenlabs/react';
import './WarmUpSession.css';

import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';
import { FaceDetection } from '@mediapipe/face_detection';
import { Holistic } from '@mediapipe/holistic';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';


// API Configuration
const API_BASE_URL = 'http://localhost:8000';

// Helper function to send events to Django backend via HTTP POST
const sendEventToBackend = async (eventType, data) => {
  try {
    const response = await fetch(`${API_BASE_URL}/monitor/save-event/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: eventType,
        ...data
      })
    });

    const result = await response.json();
    console.log('✅ Event saved to backend:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to save event to backend:', error);
  }
};

const CommandsWarmUpSession = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState('initializing');
  const [errorMessage, setErrorMessage] = useState('');
  const [isCameraOn, setIsCameraOn] = useState(false);

  const [isFinishing, setIsFinishing] = useState(false);

  const [currentCommand, setCurrentCommand] = useState(null);
  const [commandCompleted, setCommandCompleted] = useState(false);
  const [score, setScore] = useState(0);

  const [waveDetected, setWaveDetected] = useState(false);
  const [faceAbsent, setFaceAbsent] = useState(false);

  // Detection state refs
  const activeCommandRef = useRef(null); // 'WAVE', 'CLAP', 'NOSE_TOUCH', 'RAISE_HAND'
  const commandCompletedRef = useRef(false);
  const waveDetectionEnabledRef = useRef(true);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const hasStartedRef = useRef(false);

  const holisticRef = useRef(null);
  const faceDetectionRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Detection state for gestures
  const detectionStateRef = useRef({
    // Clap detection
    clapCount: 0,
    isProcessingClap: false,
    // Nose touch detection
    noseTouchStreak: 0,
    lastNoseTouchAt: 0,
    // Wave detection
    waveCount: 0,
    isWaving: false,
    waveStartTime: 0,
    lastWaveTime: 0,
    // Face detection
    lastFaceDetectedTime: Date.now(),
    isAbsent: false,
    absenceNotified: false
  });

  const conversation = useConversation({
    onConnect: () => {
      console.log('✅ Successfully connected to ElevenLabs agent');
    },
    onMessage: (message) => {
      console.log('📩 Received message:', message);

      let messageText = '';
      if (message.message) {
        messageText = message.message.toLowerCase();
      } else if (message.text) {
        messageText = message.text.toLowerCase();
      } else if (message.messages && Array.isArray(message.messages)) {
        const textMessage = message.messages.find(m => m.type === 'text');
        messageText = textMessage?.text?.toLowerCase() || '';
      }

      console.log('🔍 Extracted text:', messageText);

      // --- DETECT COMMANDS FROM AGENT ---

      // Wave command
      if (messageText.includes('wave') && (messageText.includes('can you') || messageText.includes('please') || messageText.includes('try'))) {
        // Only set if not already active or completed
        if (activeCommandRef.current !== 'WAVE' || commandCompletedRef.current) {
          console.log('🎯 Agent asked for WAVE');
          activeCommandRef.current = 'WAVE';
          commandCompletedRef.current = false;
          setCurrentCommand('👋 WAVE');
          setCommandCompleted(false);
        }
      }

      // Clap command
      if (messageText.includes('clap') && (messageText.includes('can you') || messageText.includes('please') || messageText.includes('try') || messageText.includes('hands'))) {
        if (activeCommandRef.current !== 'CLAP' || commandCompletedRef.current) {
          console.log('🎯 Agent asked for CLAP');
          activeCommandRef.current = 'CLAP';
          commandCompletedRef.current = false;
          setCurrentCommand('👏 CLAP');
          setCommandCompleted(false);
          // Reset clap count
          detectionStateRef.current.clapCount = 0;
        }
      }

      // Touch nose command
      if ((messageText.includes('touch') && messageText.includes('nose')) ||
        (messageText.includes('point') && messageText.includes('nose'))) {
        if (activeCommandRef.current !== 'NOSE_TOUCH' || commandCompletedRef.current) {
          console.log('🎯 Agent asked for NOSE_TOUCH');
          activeCommandRef.current = 'NOSE_TOUCH';
          commandCompletedRef.current = false;
          setCurrentCommand('👃 TOUCH NOSE');
          setCommandCompleted(false);
          // Reset nose touch state
          detectionStateRef.current.noseTouchStreak = 0;
        }
      }

      // Raise hand command
      if (messageText.includes('raise') && messageText.includes('hand')) {
        if (activeCommandRef.current !== 'RAISE_HAND' || commandCompletedRef.current) {
          console.log('🎯 Agent asked for RAISE_HAND');
          activeCommandRef.current = 'RAISE_HAND';
          commandCompletedRef.current = false;
          setCurrentCommand('✋ RAISE HAND');
          setCommandCompleted(false);
        }
      }

      // Session end check — strict detection to avoid false positives
      // Only treat explicit AI messages containing the unique phrase
      // e.g. "time to start your lesson" (case-insensitive) or
      // a strict combination like "time to start" + "lesson".
      const fromAI = (message && (message.source === 'ai' || message.role === 'assistant' || message.sender === 'ai'));
      const sessionEndStrict = messageText.includes('time to start your lesson') ||
        (messageText.includes('time to start') && messageText.includes('lesson'));

      if (fromAI && sessionEndStrict && !isFinishing) {
        console.log('✅ Session ending detected (strict match)');
        setIsFinishing(true);
      }
    },
    onError: (error) => {
      console.error('❌ Conversation error:', error);
      setErrorMessage(error.message || 'Conversation error');
      setStatus('error');
    },
    onDisconnect: () => {
      console.log('🔌 Disconnected from agent');
    }
  });

  const { status: convStatus, isSpeaking, startSession, endSession } = conversation;

  // Initialize username
  useEffect(() => {
    const storedUsername = sessionStorage.getItem('username') || localStorage.getItem('username') || 'Explorer';
    setUsername(storedUsername);
    setStatus('ready');
  }, []);

  // Handler when a command is successfully completed
  const handleCommandSuccess = useCallback((commandType) => {
    if (commandCompletedRef.current) return; // Prevent double triggers

    commandCompletedRef.current = true;
    setCommandCompleted(true);
    setScore(prev => prev + 10);

    console.log(`✅ Command ${commandType} completed successfully!`);

    // Send success signal to ElevenLabs agent
    const signals = {
      'WAVE': '[STUDENT_WAVED]',
      'CLAP': '[STUDENT_CLAPPED]',
      'NOSE_TOUCH': '[STUDENT_TOUCHED_NOSE]',
      'RAISE_HAND': '[STUDENT_RAISED_HAND]'
    };

    const signal = signals[commandType] || '[COMMAND_COMPLETED]';

    // Use conversation.sendUserMessage (like in the working WarmUpSession)
    if (conversation && typeof conversation.sendUserMessage === 'function') {
      console.log(`📤 Sending signal to agent: ${signal}`);
      try {
        conversation.sendUserMessage(signal);
        console.log(`✅ Signal sent successfully`);
      } catch (err) {
        console.error(`❌ Failed to send signal:`, err);
      }
    } else {
      console.error('❌ conversation.sendUserMessage is not available');
    }

    // Clear command display after a moment
    setTimeout(() => {
      setCurrentCommand(null);
      setCommandCompleted(false);
      activeCommandRef.current = null;
    }, 2000);

  }, [conversation]);

  // Face absence handler
  const handleFaceAbsent = useCallback(async (duration) => {
    console.log(`😶 Face absent for ${duration}ms`);
    setFaceAbsent(true);

    // Send to ElevenLabs agent
    if (conversation && typeof conversation.sendUserMessage === 'function') {
      console.log('📤 Sending face absence event to agent');
      conversation.sendUserMessage('[STUDENT_LEFT_SCREEN]');
    }
  }, [conversation]);

  // Face return handler
  const handleFaceReturned = useCallback(() => {
    console.log('😊 Face returned!');
    setFaceAbsent(false);

    // Send to ElevenLabs agent
    if (conversation && typeof conversation.sendUserMessage === 'function') {
      console.log('📤 Sending face return event to agent');
      conversation.sendUserMessage('[STUDENT_RETURNED]');
    }
  }, [conversation]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (holisticRef.current) {
      holisticRef.current.close();
      holisticRef.current = null;
    }

    if (faceDetectionRef.current) {
      faceDetectionRef.current.close();
      faceDetectionRef.current = null;
    }

    setIsCameraOn(false);
  }, []);

  // Initialize camera and Holistic detection
  const initializeCamera = useCallback(async (stream) => {
    const video = videoRef.current;
    if (!video) {
      console.error('❌ Video element not found');
      return;
    }

    // Assign stream to video
    video.srcObject = stream;

    // Wait for video to be ready and play
    try {
      await video.play();
      console.log('✅ Video is playing');
    } catch (err) {
      console.error('❌ Video play error:', err);
    }

    // Initialize Holistic (combines pose, face, hands)
    try {
      const holistic = new Holistic({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
      });

      holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      console.log('✅ MediaPipe Holistic initialized');

      // Initialize Face Detection for absence detection
      const faceDetection = new FaceDetection({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
      });

      faceDetection.setOptions({
        model: 'short',
        minDetectionConfidence: 0.5
      });

      console.log('✅ MediaPipe FaceDetection initialized');

      // Process Holistic results
      holistic.onResults((results) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const activeCommand = activeCommandRef.current;
        const state = detectionStateRef.current;

        // Need pose landmarks for most detections
        if (!results.poseLandmarks) {
          ctx.restore();
          return;
        }

        const landmarks = results.poseLandmarks;

        // --- WAVE DETECTION (using right hand landmarks) ---
        if (activeCommand === 'WAVE') {
          // Try right hand first, then left
          const handLandmarks = results.rightHandLandmarks || results.leftHandLandmarks;

          if (handLandmarks) {
            // Draw hand
            drawConnectors(ctx, handLandmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
            drawLandmarks(ctx, handLandmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });

            const wrist = handLandmarks[0];
            const indexTip = handLandmarks[8];
            const middleTip = handLandmarks[12];

            // Fingers above wrist = waving position
            if (indexTip && middleTip && indexTip.y < wrist.y && middleTip.y < wrist.y) {
              const now = Date.now();

              if (!state.isWaving) {
                state.isWaving = true;
                state.waveStartTime = now;
                state.waveCount = 1;
              } else if (now - state.lastWaveTime > 200) {
                state.waveCount++;
                state.lastWaveTime = now;

                if (state.waveCount >= 3 && now - state.waveStartTime < 2000) {
                  handleCommandSuccess('WAVE');
                  state.waveCount = 0;
                }
              }
            } else {
              state.isWaving = false;
            }
          }
        }

        // --- CLAP DETECTION (from Game.jsx) ---
        if (activeCommand === 'CLAP') {
          const leftWrist = landmarks[15];
          const rightWrist = landmarks[16];
          const dist = Math.hypot(leftWrist.x - rightWrist.x, leftWrist.y - rightWrist.y);

          // Debug log every 30 frames to avoid spam
          if (!state.clapLogCounter) state.clapLogCounter = 0;
          state.clapLogCounter++;
          if (state.clapLogCounter % 30 === 0) {
            console.log(`👐 Wrist distance: ${dist.toFixed(3)} (need < 0.20)`);
          }

          // Loosened threshold from 0.15 to 0.20
          if (dist < 0.20 && !state.isProcessingClap) {
            state.isProcessingClap = true;
            state.clapCount += 1;
            console.log(`👏 Clap detected! Count: ${state.clapCount}/2`);

            if (state.clapCount >= 2) {
              handleCommandSuccess('CLAP');
            }

            setTimeout(() => { state.isProcessingClap = false; }, 500);
          }
        }

        // --- NOSE TOUCH DETECTION (from Game.jsx) ---
        if (activeCommand === 'NOSE_TOUCH') {
          // Use MediaPipe face landmarks (face mesh) for precise nose tip
          if (results.faceLandmarks && results.faceLandmarks.length > 0) {
            // nose tip candidates: 1 or 4 (face mesh indexing can vary by version)
            const faceNose = results.faceLandmarks[1] || results.faceLandmarks[4];

            if (faceNose) {
              const leftHand = results.leftHandLandmarks;
              const rightHand = results.rightHandLandmarks;

              const checkTouchFace = (handLandmarks) => {
                if (!handLandmarks || !handLandmarks.length) return false;
                const indexTip = handLandmarks[8];
                if (!indexTip) return false;
                const dx = indexTip.x - faceNose.x;
                const dy = indexTip.y - faceNose.y;
                const dist = Math.hypot(dx, dy);
                return dist < 0.08; // Loosened from 0.05 to 0.08
              };

              const now = Date.now();
              const leftHit = checkTouchFace(leftHand);
              const rightHit = checkTouchFace(rightHand);

              // Debug log
              if (!state.noseLogCounter) state.noseLogCounter = 0;
              state.noseLogCounter++;
              if (state.noseLogCounter % 30 === 0) {
                const hasLeftHand = leftHand && leftHand.length > 0;
                const hasRightHand = rightHand && rightHand.length > 0;
                console.log(`👃 Nose touch - leftHand: ${hasLeftHand}, rightHand: ${hasRightHand}, leftHit: ${leftHit}, rightHit: ${rightHit}`);
              }

              if (leftHit || rightHit) {
                state.noseTouchStreak = (state.noseTouchStreak || 0) + 1;
              } else {
                state.noseTouchStreak = 0;
              }

              if ((state.noseTouchStreak >= 3) && (now - state.lastNoseTouchAt > 1500)) {
                state.lastNoseTouchAt = now;
                state.noseTouchStreak = 0;
                handleCommandSuccess('NOSE_TOUCH');
              }
            }
          } else {
            // No face landmarks - log this
            if (!state.noFaceLogCounter) state.noFaceLogCounter = 0;
            state.noFaceLogCounter++;
            if (state.noFaceLogCounter % 60 === 0) {
              console.log('⚠️ No face landmarks detected for nose touch');
            }
          }
        }

        // --- RAISE HAND DETECTION (from Game.jsx) ---
        if (activeCommand === 'RAISE_HAND') {
          const nose = landmarks[0];
          const leftWrist = landmarks[15];
          const rightWrist = landmarks[16];

          // Either hand above nose
          if (leftWrist.y < nose.y || rightWrist.y < nose.y) {
            handleCommandSuccess('RAISE_HAND');
          }
        }

        ctx.restore();
      });

      // Face detection for absence
      faceDetection.onResults((results) => {
        const now = Date.now();
        const state = detectionStateRef.current;

        if (results.detections && results.detections.length > 0) {
          state.lastFaceDetectedTime = now;

          if (state.isAbsent) {
            state.isAbsent = false;
            state.absenceNotified = false;
            handleFaceReturned();
          }
        } else {
          const absenceDuration = now - state.lastFaceDetectedTime;

          if (absenceDuration > 3000 && !state.absenceNotified) {
            state.isAbsent = true;
            state.absenceNotified = true;
            handleFaceAbsent(absenceDuration);
          }
        }
      });

      holisticRef.current = holistic;
      faceDetectionRef.current = faceDetection;

      // Animation loop
      const processFrame = async () => {
        if (!video || video.readyState !== 4) {
          animationFrameRef.current = requestAnimationFrame(processFrame);
          return;
        }

        try {
          await holistic.send({ image: video });
          await faceDetection.send({ image: video });
        } catch (error) {
          console.error('❌ MediaPipe processing error:', error);
        }

        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      console.log('🎥 Starting camera frame processing');
      processFrame();

    } catch (mpError) {
      console.error('❌ MediaPipe initialization error:', mpError);
    }
  }, [handleCommandSuccess, handleFaceAbsent, handleFaceReturned]);

  // Start camera and conversation
  const startCameraAndConversation = async () => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    setStatus('active');

    try {
      // Get camera stream
      console.log('📹 Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });

      console.log('✅ Camera stream obtained');
      streamRef.current = stream;

      // Set camera on so video element renders
      setIsCameraOn(true);

      // Wait for React to render the video element
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initialize camera and detection
      console.log('🔧 Initializing camera...');
      await initializeCamera(stream);
      console.log('✅ Camera initialized');

      // Start ElevenLabs conversation
      const config = {
        agentId: 'agent_4701kadwvc69fkvs5ycwka6p0gr3',
        overrides: {
          agent: {
            prompt: {
              prompt: `You are Blizz, an upbeat and friendly AI guide helping Explorer follow commands.

## YOUR ROLE
Guide the child through 3 simple commands, watching for their actions.

## DETECTION SIGNALS
The system sends you these signals when actions are detected:
- [STUDENT_CLAPPED] - Student clapped twice
- [STUDENT_TOUCHED_NOSE] - Student touched their nose  
- [STUDENT_RAISED_HAND] - Student raised one hand

## SESSION FLOW

### INTRODUCTION
"Okay, Explorer… now it's YOUR turn to follow some commands! Sit comfortably, and get ready. Suki and I will watch carefully!"

### COMMAND 1 — Clap Your Hands Twice
Say: "Here comes your first command… Clap your hands twice!"
- If you receive [STUDENT_CLAPPED]: "You did it! That was perfect clapping!"
- If no signal after 10 seconds: "Give it another try, Explorer — two claps!"

### COMMAND 2 — Touch Your Nose
Say: "Great job! Ready for command number two? Touch your nose!"
- If you receive [STUDENT_TOUCHED_NOSE]: "Nice! You followed that command SO quickly!"
- If no signal after 10 seconds: "Try again, Explorer — touch your nose."

### COMMAND 3 — Raise One Hand
Say: "All right… last one for this round! Raise one hand up high!"
- If you receive [STUDENT_RAISED_HAND]: "Woo-hoo! Look at that hand go! You nailed all the commands!"
- If no signal after 10 seconds: "Give it another go — raise one hand up high!"


## IMPORTANT RULES
1. Give ONE command at a time
2. WAIT for the signal or 10 seconds before responding
3. Be encouraging even if they need to retry
4. Keep energy high and playful
5. Use the exact phrases from the script

### 6. CELEBRATION & END
After all 3 commands: "Amazing work, Explorer! You completed everything perfectly! **Time to start your lesson!**"

**CRITICAL: After saying "Time to start your lesson" - STOP SPEAKING. The session will end automatically.**`
            },
            firstMessage: `Hi ${username}! It's so great to see you today! How are you feeling?`
          }
        }
      };

      console.log('📤 Starting ElevenLabs session...');
      await startSession(config);
      console.log('✅ Session started successfully!');

    } catch (error) {
      console.error('❌ FAILED:', error);
      setErrorMessage(error.message || 'Failed to start session.');
      setStatus('error');
      hasStartedRef.current = false;
      stopCamera();
    }
  };

  const handleSessionComplete = useCallback(async () => {
    if (status === 'completed') return;
    console.log('🎉 SESSION COMPLETE!');
    setStatus('completed');

    setCurrentCommand(null);

    stopCamera();

    if (endSession) {
      await endSession();
    }

    setTimeout(() => {
      // Navigate to next activity
      navigate('/dash', { state: { autoPlay: true } });
    }, 2000);
  }, [status, stopCamera, endSession, navigate]);

  // Safety timer to navigate after agent stops speaking
  useEffect(() => {
    if (isFinishing && !isSpeaking) {
      const timer = setTimeout(() => {
        console.log('🚀 Session complete. Navigating...');
        handleSessionComplete();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [isFinishing, isSpeaking, handleSessionComplete]);

  const skipSession = () => {
    stopCamera();
    if (endSession) {
      endSession();
    }
    navigate('/dash');
  };

  return (
    <div className="warmup-session-container">
      <div className="warmup-background">
        <img src="/warmupback.png" alt="Background" />
      </div>

      <div className="camera-widget">
        <div className="camera-frame">
          {isCameraOn ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video"
                style={{ transform: 'scaleX(-1)' }}
              />
              <canvas
                ref={canvasRef}
                width="640"
                height="480"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  transform: 'scaleX(-1)',
                  pointerEvents: 'none'
                }}
              />
            </>
          ) : (
            <div className="camera-placeholder">
              <div className="camera-icon">📹</div>
            </div>
          )}

          {commandCompleted && (
            <div style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: 'lime',
              color: 'black',
              padding: '8px 12px',
              borderRadius: '8px',
              fontWeight: 'bold',
              fontSize: '14px',
              zIndex: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}>
              ✅ Great Job!
            </div>
          )}

          {faceAbsent && (
            <div style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: 'orange',
              color: 'black',
              padding: '8px 12px',
              borderRadius: '8px',
              fontWeight: 'bold',
              fontSize: '14px',
              zIndex: 10,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}>
              😶 Where did you go?
            </div>
          )}

          <div className="camera-controls">
            <button className="camera-control-btn mic-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>
            <button className="camera-control-btn video-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {currentCommand && (
        <div className="word-display-container">
          <div className="word-display" style={{
            backgroundColor: commandCompleted ? '#4CAF50' : '#2196F3',
            transition: 'background-color 0.3s ease'
          }}>
            {currentCommand}
          </div>
          <div style={{
            marginTop: '10px',
            fontSize: '1.2rem',
            color: '#333'
          }}>
            Score: {score}
          </div>
        </div>
      )}

      <div className="warmup-main-content">
        {status === 'ready' && (
          <>
            <h1 className="welcome-title">Welcome, {username}!</h1>
            <p style={{ color: '#666', marginBottom: '20px' }}>
              Get ready for a fun activity! 🎮
            </p>
            <button onClick={startCameraAndConversation} className="start-btn">
              Start
            </button>
          </>
        )}

        {status === 'initializing' && (
          <div className="status-container">
            <div className="spinner"></div>
            <p className="status-text">Getting things ready...</p>
          </div>
        )}

        {status === 'active' && (
          <div className="active-container">
            <div className="listening-indicator">
              <div className="pulse-ring"></div>
              <div className="pulse-ring delay-1"></div>
              <div className="pulse-ring delay-2"></div>
            </div>
            <p className="status-text">
              {isSpeaking ? '🗣️ Emma is speaking...' : '👂 Listening...'}
            </p>
          </div>
        )}

        {status === 'completed' && (
          <div className="status-container">
            <p className="status-text">🎉 Great job! You completed all commands!</p>
            <p style={{ color: '#666' }}>Final Score: {score}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="error-container">
            <p className="error-title">Oops! Something went wrong.</p>
            <p className="error-message">{errorMessage}</p>
            <button onClick={skipSession} className="skip-btn">
              Skip to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CommandsWarmUpSession;
