import { Navigate } from 'react-router-dom';
import useAdminStore from '@/store/useAdminStore';
import URL from '@/constants/url';

const RequireAdmin = ({ children }) => {
    const { isAdmin } = useAdminStore();
    if (!isAdmin) {
        return <Navigate to={URL.ADMIN_LOGIN} replace />;
    }
    return children;
};

export default RequireAdmin;
