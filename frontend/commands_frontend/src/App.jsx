import React from 'react';
import { BrowserRouter } from 'react-router-dom';
// Make sure this path matches where you saved your Game.jsx file
import Game from './components/pages/WarmUpSessionCommands';

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        <Game />
      </div>
    </BrowserRouter>
  );
}

export default App;