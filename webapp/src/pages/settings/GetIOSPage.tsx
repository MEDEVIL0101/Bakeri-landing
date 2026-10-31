import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/ui';
import { TESTFLIGHT_URL } from '../../lib/plans';

const QR = `${import.meta.env.BASE_URL}testflight-qr.png`;
const TESTFLIGHT_APP = 'https://apps.apple.com/app/testflight/id899247664';

/**
 * Get on iOS — the iPhone app is in beta on TestFlight and is sign-in only:
 * every account is created here on the web first.
 */
export function GetIOSPage() {
  const { session } = useAuth();
  const onIPhone = /iPhone|iPod/.test(navigator.userAgent);

  return (
    <div className="page page-narrow">
      <PageHeader title="Get on iOS" subtitle="Run your shop from your iPhone too. Bakeri for iPhone is in beta on TestFlight, Apple’s app for trying apps early." />

      <div className="ios-card">
        {!onIPhone && (
          <div className="ios-qr">
            <img src={QR} alt="QR code for Bakeri on TestFlight" width={186} height={186} />
            <span className="small muted">Scan with your iPhone camera</span>
          </div>
        )}
        <ol className="ios-steps">
          <li>
            <strong>Install TestFlight</strong>
            <span className="muted">Free from the App Store. <a href={TESTFLIGHT_APP} target="_blank" rel="noopener noreferrer">Get TestFlight ↗</a></span>
          </li>
          <li>
            <strong>{onIPhone ? 'Tap the button below' : 'Scan the QR code with your iPhone'}</strong>
            <span className="muted">It opens Bakeri in TestFlight. Tap <b>Accept</b>, then <b>Install</b>.</span>
          </li>
          <li>
            <strong>Sign in</strong>
            <span className="muted">Open Bakeri and log in with {session?.user.email ? <b>{session.user.email}</b> : 'the account you use here'}. Everything you’ve set up on the web is already there.</span>
          </li>
        </ol>
      </div>

      <div className="ios-actions">
        <a className="btn btn-primary" href={TESTFLIGHT_URL} target="_blank" rel="noopener noreferrer"><span>Open Bakeri in TestFlight</span></a>
        <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(TESTFLIGHT_URL)}><span>Copy link</span></button>
      </div>
      <p className="small muted">The link: <a href={TESTFLIGHT_URL} target="_blank" rel="noopener noreferrer">{TESTFLIGHT_URL.replace('https://', '')}</a>. Send it to yourself if you’re not on your iPhone right now. On Android? Bakeri works right here in your browser. Add it to your home screen for one-tap access.</p>
    </div>
  );
}
