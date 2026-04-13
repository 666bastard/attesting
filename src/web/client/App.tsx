import React, { useState, useEffect, Suspense, lazy, createContext, useContext } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import Toasts from './components/layout/Toasts';
import { useToast, type Toast } from './hooks/useToast';

const Dashboard = lazy(() => import('./components/dashboard/Dashboard'));
const CatalogList = lazy(() => import('./components/catalogs/CatalogList'));
const MappingExplorer = lazy(() => import('./components/mappings/MappingExplorer'));
const ImplWorkspace = lazy(() => import('./components/implementations/ImplWorkspace'));
const DiffViewer = lazy(() => import('./components/diff/DiffViewer'));
const ExportCenter = lazy(() => import('./components/exports/ExportCenter'));
const GovernancePage = lazy(() => import('./components/governance/GovernancePage'));
const RiskPage = lazy(() => import('./components/risk/RiskPage'));
const ImportProprietary = lazy(() => import('./components/ImportProprietary'));
const AssetsPage = lazy(() => import('./components/assets/AssetsPage'));
const IntelPage = lazy(() => import('./components/intel/IntelPage'));
const DriftPage = lazy(() => import('./components/drift/DriftPage'));
const ConnectorsPage = lazy(() => import('./components/connectors/ConnectorsPage'));
const EvidencePage = lazy(() => import('./components/evidence/EvidencePage'));
const SetupWizard = lazy(() => import('./components/onboarding/SetupWizard'));

interface ToastCtx { add: (msg: string, type?: 'success' | 'error') => void }
const ToastContext = createContext<ToastCtx>({ add: () => {} });
export const useToastContext = () => useContext(ToastContext);

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const [scope, setScope] = useState('');
  const { toasts, add, dismiss } = useToast();
  const location = useLocation();
  const [showWizard, setShowWizard] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/onboarding/complete')
      .then(r => r.json())
      .then(d => setShowWizard(!d.complete))
      .catch(() => setShowWizard(false));
  }, []);

  if (showWizard === null) return <PageLoader />;

  if (showWizard) {
    return (
      <ToastContext.Provider value={{ add }}>
        <Suspense fallback={<PageLoader />}>
          <SetupWizard onComplete={() => setShowWizard(false)} />
        </Suspense>
        <Toasts toasts={toasts} onDismiss={dismiss} />
      </ToastContext.Provider>
    );
  }

  return (
    <ToastContext.Provider value={{ add }}>
      <div className="flex min-h-screen relative">
        {/* Animated gradient background */}
        <div className="gradient-bg" aria-hidden="true" />

        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded">
          Skip to content
        </a>

        <Sidebar />

        <div className="flex-1 flex flex-col min-w-0 relative z-10">
          <Header scope={scope} onScopeChange={setScope} />
          <main id="main-content" className="flex-1 overflow-auto" role="main">
            <div key={location.pathname} className="animate-fade-in">
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Dashboard scope={scope} />} />
                  <Route path="/catalogs" element={<CatalogList scope={scope} />} />
                  <Route path="/catalogs/:shortName" element={<CatalogList scope={scope} />} />
                  <Route path="/mappings" element={<MappingExplorer />} />
                  <Route path="/implementations" element={<ImplWorkspace scope={scope} />} />
                  <Route path="/governance/*" element={<GovernancePage />} />
                  <Route path="/risk/*" element={<RiskPage />} />
                  <Route path="/assets" element={<AssetsPage />} />
                  <Route path="/intel/*" element={<IntelPage />} />
                  <Route path="/drift/*" element={<DriftPage />} />
                  <Route path="/connectors" element={<ConnectorsPage />} />
                  <Route path="/evidence" element={<EvidencePage />} />
                  <Route path="/diff" element={<DiffViewer />} />
                  <Route path="/import" element={<ImportProprietary />} />
                  <Route path="/export" element={<ExportCenter scope={scope} />} />
                </Routes>
              </Suspense>
            </div>
          </main>
        </div>

        <Toasts toasts={toasts} onDismiss={dismiss} />
      </div>
    </ToastContext.Provider>
  );
}
