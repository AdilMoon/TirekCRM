import type { Metadata } from 'next';
import { PasswordRecovery } from '../../features/password-recovery';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function ResetPasswordPage() { return <PasswordRecovery/>; }
