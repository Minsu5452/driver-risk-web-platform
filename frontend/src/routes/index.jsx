import { useEffect, useRef } from "react";
import { Navigate, Routes, Route, useLocation } from "react-router-dom";

import URL from "@/constants/url";

import EgovHeader from "@/components/EgovHeader";
import EgovFooter from "@/components/EgovFooter";
import EgovError from "@/components/EgovError";
import EgovMain from "@/pages/main/EgovMain";
import RiskDashboard from "@/pages/risk/RiskDashboard";
import RiskList from "@/pages/risk/RiskList";
import RiskDiagnosis from "@/pages/risk/RiskDiagnosis";
import RiskAnalysis from "@/pages/risk/RiskAnalysis";
import RiskDownload from "@/pages/risk/RiskDownload";
import AdminLogin from "@/pages/admin/AdminLogin";
import AdminDashboard from "@/pages/admin/AdminDashboard";
import RequireAdmin from "@/components/RequireAdmin";
import useAnalysisStore from "@/store/useAnalysisStore";

const RequireUpload = ({ children }) => {
  const { isUploaded } = useAnalysisStore();
  if (!isUploaded) {
    return <Navigate to={URL.MAIN} replace />;
  }
  return children;
};

const RootRoutes = () => {
  const location = useLocation();
  const pageRef = useRef(null);

  useEffect(() => {
    const el = pageRef.current;
    if (el) {
      el.classList.remove('page-content');
      void el.offsetWidth;
      el.classList.add('page-content');
    }
  }, [location.pathname]);

  return (
    <>
      <EgovHeader />
      <div ref={pageRef} className="page-content">
        <Routes>
          <Route path="/" element={<EgovMain />} />
          <Route path={URL.MAIN} element={<EgovMain />} />
          <Route path={URL.ERROR} element={<EgovError />} />

          <Route path={URL.RISK_DASHBOARD} element={<RequireUpload><RiskDashboard /></RequireUpload>} />
          <Route path={URL.RISK_LIST} element={<RequireUpload><RiskList /></RequireUpload>} />
          <Route path={URL.RISK_DIAGNOSIS} element={<RequireUpload><RiskDiagnosis /></RequireUpload>} />
          <Route path={URL.RISK_ANALYSIS} element={<RequireUpload><RiskAnalysis /></RequireUpload>} />
          <Route path={URL.RISK_DOWNLOAD} element={<RequireUpload><RiskDownload /></RequireUpload>} />

          <Route path={URL.ADMIN_LOGIN} element={<AdminLogin />} />
          <Route path={URL.ADMIN_DASHBOARD} element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
        </Routes>
      </div>

      <EgovFooter />
    </>
  );
};

export default RootRoutes;