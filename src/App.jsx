import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import KakaoMap from './components/KakaoMap';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/map" element={<KakaoMap />} />
        <Route path="/" element={<div>홈입니다</div>} />
      </Routes>
    </Router>
  );
}

export default App;
