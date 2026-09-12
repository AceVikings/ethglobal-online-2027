import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppHeader } from "./components/AppHeader";
import { DecisionPage } from "./pages/DecisionPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  return (
    <HashRouter>
      <AppHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/flow" element={<Navigate replace to="/?section=flow" />} />
        <Route path="/desk" element={<Navigate replace to="/?section=desk" />} />
        <Route path="/activity" element={<Navigate replace to="/?section=activity" />} />
        <Route path="/proof" element={<Navigate replace to="/?section=proof" />} />
        <Route path="/trades/:tradeDigest" element={<DecisionPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </HashRouter>
  );
}
