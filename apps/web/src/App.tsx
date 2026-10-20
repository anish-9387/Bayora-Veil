import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { OverviewPage } from './pages/OverviewPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { LeakageLabPage } from './pages/LeakageLabPage';
import { ForensicsPage } from './pages/ForensicsPage';
import { ThreatModelPage } from './pages/ThreatModelPage';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/leakage" element={<LeakageLabPage />} />
        <Route path="/forensics" element={<ForensicsPage />} />
        <Route path="/threat-model" element={<ThreatModelPage />} />
      </Routes>
    </Layout>
  );
}

export default App;