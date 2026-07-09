import { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { LogOut, ChevronDown } from "lucide-react";

import URL from "@/constants/url";

import { SITE_NAME } from "@/constants/site";
import useAnalysisStore from "@/store/useAnalysisStore";
import useAdminStore from "@/store/useAdminStore";
import AnalysisControls from '@/components/AnalysisControls';

function EgovHeader() {
  const { isUploaded, isDownloading } = useAnalysisStore();
  const { isAdmin, logout } = useAdminStore();
  const navigate = useNavigate();
  const location = useLocation();

  const guardNav = (e) => {
    if (isDownloading && !window.confirm('다운로드가 진행 중입니다. 페이지를 떠나시겠습니까?\n이동하면 다운로드가 중단됩니다.')) {
      e.preventDefault();
    }
  };

  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [logoutPhase, setLogoutPhase] = useState(null); // null | 'overlay' | 'done'
  const adminMenuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!adminMenuOpen) return;
    const onClickOutside = (e) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target)) {
        setAdminMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [adminMenuOpen]);

  // Close dropdown on route change
  useEffect(() => {
    setAdminMenuOpen(false);
  }, [location.pathname]);

  const handleAdminLogout = () => {
    setAdminMenuOpen(false);
    setLogoutPhase('overlay');
    setTimeout(() => {
      logout();
      // 관리자 전용 페이지에 있으면 메인으로, 아니면 현재 페이지 유지
      if (location.pathname.startsWith('/admin')) {
        navigate(URL.MAIN);
      }
      setLogoutPhase('done');
      setTimeout(() => setLogoutPhase(null), 600);
    }, 1000);
  };

  return (
    <>
      <div className="header">
        <div className="inner">
          <h1 className="logo">
            <Link to={URL.MAIN} onClick={guardNav} className="w">
              <span className="logo-text">{SITE_NAME}</span>
            </Link>
            <Link to={URL.MAIN} onClick={guardNav} className="m">
              <span className="logo-text">{SITE_NAME}</span>
            </Link>
          </h1>

          <div className="gnb">
            <h2 className="blind">주메뉴</h2>
            {isUploaded && (
              <ul>
                <li>
                  <NavLink
                    to={URL.RISK_DASHBOARD}
                    onClick={guardNav}
                    className={({ isActive }) => (isActive ? "cur" : "")}
                  >
                    대시보드
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to={URL.RISK_LIST}
                    onClick={guardNav}
                    className={({ isActive }) => (isActive ? "cur" : "")}
                  >
                    운전자 목록
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to={URL.RISK_ANALYSIS}
                    onClick={guardNav}
                    className={({ isActive }) => (isActive ? "cur" : "")}
                  >
                    비교 분석
                  </NavLink>
                </li>
                <li>
                  <NavLink
                    to={URL.RISK_DOWNLOAD}
                    onClick={guardNav}
                    className={({ isActive }) => (isActive ? "cur" : "")}
                  >
                    다운로드
                  </NavLink>
                </li>
              </ul>
            )}
          </div>

          <div className="header-right">
            {isUploaded && <AnalysisControls />}
            {isUploaded && <div className="header-divider" />}

            {!isAdmin ? (
              <Link to={URL.ADMIN_LOGIN} state={{ from: location.pathname }} className="admin-toggle login">
                관리자 로그인
              </Link>
            ) : (
              <div className="admin-menu" ref={adminMenuRef}>
                <button
                  className={`admin-toggle active${adminMenuOpen ? " open" : ""}`}
                  onClick={() => setAdminMenuOpen((v) => !v)}
                >
                  관리자
                  <ChevronDown size={13} className="admin-chevron" />
                </button>
                <div className={`admin-dropdown${adminMenuOpen ? " open" : ""}`}>
                  <Link to={URL.ADMIN_DASHBOARD}>재학습 관리</Link>
                  <div className="admin-dropdown-sep" />
                  <button onClick={handleAdminLogout}>로그아웃</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {logoutPhase && (
        <div className={`logout-overlay ${logoutPhase}`}>
          <div className="logout-card">
            <div className="logout-icon">
              <LogOut size={28} />
            </div>
            <p className="logout-text">로그아웃 되었습니다</p>
            <div className="logout-bar"><div className="logout-bar-fill" /></div>
          </div>
        </div>
      )}
    </>
  );
}

export default EgovHeader;
