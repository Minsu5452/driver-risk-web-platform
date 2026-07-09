import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Container, Paper, Title, TextInput, PasswordInput, Button, Stack, Text } from '@mantine/core';
import { LogIn, Shield } from 'lucide-react';
import useAdminStore from '@/store/useAdminStore';
import adminClient from '@/api/adminClient';
import URL from '@/constants/url';

function AdminLogin() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const { login } = useAdminStore();

    // 로그인 전 페이지로 돌아가기 (state.from 또는 이전 페이지)
    const from = location.state?.from || URL.MAIN;

    // PC 재부팅 직후 자동시작으로 서비스가 완전히 기동되기 전에
    // 로그인을 시도하면 502/503/504/timeout 이 발생할 수 있다.
    // 네트워크성 실패는 자동으로 5초 간격, 최대 5회까지 재시도하여
    // 사용자가 수동으로 다시 누르지 않아도 되도록 한다.
    // 비밀번호 틀림(401) 같은 "진짜 실패" 는 재시도하지 않고 즉시 에러 표시.
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const maxAttempts = 5;
        const retryDelayMs = 5000;

        const isTransient = (err) => {
            const status = err.response?.status;
            return (
                err.code === 'ECONNABORTED' ||
                err.message?.includes('timeout') ||
                !err.response ||                 // 네트워크 아예 안 됨
                status === 502 ||
                status === 503 ||
                status === 504
            );
        };

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const res = await adminClient.post(
                    '/admin/login',
                    { username, password },
                    { timeout: 10000 }
                );
                login(res.data.token);
                navigate(from, { replace: true });
                return; // 성공 → 종료
            } catch (err) {
                // 비밀번호 틀림 등 "진짜 실패" 는 즉시 에러 표시
                if (!isTransient(err)) {
                    const detail =
                        err.response?.data?.detail ||
                        err.response?.data?.message ||
                        '로그인에 실패했습니다.';
                    setError(detail);
                    setLoading(false);
                    return;
                }

                // 네트워크성 실패 → 아직 재시도 남았으면 대기 후 재시도
                if (attempt < maxAttempts) {
                    setError(
                        `서버 준비 중입니다... (${attempt}/${maxAttempts}) ${retryDelayMs / 1000}초 후 자동으로 다시 시도합니다.`
                    );
                    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    continue;
                }

                // 모든 재시도 소진 → 최종 실패
                setError(
                    `서버가 응답하지 않습니다 (${maxAttempts}회 재시도 모두 실패). 잠시 후 다시 시도하시거나 관리자에게 문의해주세요.`
                );
                setLoading(false);
                return;
            }
        }
    };

    return (
        <Container size={460} style={{ paddingTop: 120, paddingBottom: 80 }}>
            <Paper shadow="md" p={40} radius="lg">
                <form onSubmit={handleSubmit}>
                    <Stack gap="lg">
                        <div style={{ textAlign: 'center' }}>
                            <Shield size={44} color="#228be6" />
                            <Title order={2} mt="sm">관리자 로그인</Title>
                        </div>

                        <TextInput
                            label="아이디"
                            placeholder="아이디를 입력하세요"
                            value={username}
                            onChange={(e) => setUsername(e.currentTarget.value)}
                            required
                        />

                        <PasswordInput
                            label="비밀번호"
                            placeholder="비밀번호를 입력하세요"
                            value={password}
                            onChange={(e) => setPassword(e.currentTarget.value)}
                            required
                        />

                        {error && (
                            <Text c="red" size="sm" ta="center">{error}</Text>
                        )}

                        <Button
                            type="submit"
                            fullWidth
                            loading={loading}
                            leftSection={<LogIn size={16} />}
                        >
                            로그인
                        </Button>
                    </Stack>
                </form>
            </Paper>
        </Container>
    );
}

export default AdminLogin;
