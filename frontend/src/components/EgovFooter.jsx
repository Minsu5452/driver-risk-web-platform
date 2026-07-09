import { Link } from "react-router-dom";
import { SITE_NAME, SITE_NOTICE, COPYRIGHT } from "@/constants/site";

function EgovFooter() {
  return (
    <div className="footer">
      <div className="inner">
        <h1>
          <Link to="/">
            <span className="footer-logo-text">{SITE_NAME}</span>
          </Link>
        </h1>
        <div className="info">
          <p>{SITE_NOTICE}</p>
          <p className="copy">&copy; {COPYRIGHT}</p>
        </div>
      </div>
    </div>
  );
}

export default EgovFooter;
