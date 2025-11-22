import React from 'react';
import './VoiceAgentUI.css';

const VoiceAgentUI = ({ isSpeaking }) => {
    // Determine state class
    const stateClass = isSpeaking ? 'speaking' : 'listening';
    // Simpler, more elegant text
    const statusText = isSpeaking ? 'Blizz is speaking...' : 'Listening...';

    return (
        <div className="voice-agent-container">
            <div className={`agent-orb ${stateClass}`}>
                {/* Ripples for speaking state */}
                {isSpeaking && (
                    <>
                        <div className="ripple"></div>
                        <div className="ripple"></div>
                        <div className="ripple"></div>
                    </>
                )}
            </div>
            <div className="agent-status-text">
                {statusText}
            </div>
        </div>
    );
};

export default VoiceAgentUI;
