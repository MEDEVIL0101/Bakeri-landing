import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthCallbackPage, ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './auth/AuthPages';
import { SetupPage } from './auth/SetupPage';
import { AppShell } from './layout/AppShell';
import { Spinner, ToastProvider } from './components/ui';
import { DashboardPage } from './pages/Dashboard';
import { OrdersPage } from './pages/orders/OrdersPage';
import { OrderDetailPage } from './pages/orders/OrderDetailPage';
import { OrderEditorPage } from './pages/orders/OrderEditorPage';
import { MenuPage } from './pages/menu/MenuPage';
import { MenuItemEditorPage } from './pages/menu/MenuItemEditorPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { CustomerProfilePage } from './pages/customers/CustomerProfilePage';
import { CampaignsPage } from './pages/customers/CampaignsPage';
import { SchedulePage } from './pages/schedule/SchedulePage';
import { RecipesPage } from './pages/recipes/RecipesPage';
import { RecipeEditorPage } from './pages/recipes/RecipeEditorPage';
import { RecipeDetailPage } from './pages/recipes/RecipeDetailPage';
import { StorefrontPage } from './pages/storefront/StorefrontPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { PayoutsPage } from './pages/settings/PayoutsPage';
import { ShopSettingsPage } from './pages/settings/ShopSettingsPage';
import { ReferPage } from './pages/settings/ReferPage';
import { FormsPage } from './pages/forms/FormsPage';
import { FormBuilderPage } from './pages/forms/FormBuilderPage';
import { FinancesPage } from './pages/finances/FinancesPage';
import { PackagingPage } from './pages/kitchen/PackagingPage';
import { IngredientsPage } from './pages/kitchen/IngredientsPage';
import { CalculatorPage } from './pages/kitchen/CalculatorPage';
import { TimerProvider } from './pages/kitchen/Timers';
import { PromotionsPage } from './pages/promotions/PromotionsPage';
import { PlanPage, TrialPage, WelcomePage } from './auth/PlanPages';
import { MfaChallengePage, TwoFactorPage } from './auth/TwoFactor';
import { effectiveTier } from './lib/plans';

/** Signed in, nothing else — the plan picker and welcome page sit here. */
function RequireSession() {
  const { session, recovering, mfaNeeded } = useAuth();
  const location = useLocation();
  if (session === undefined) return <div className="full-center"><Spinner /></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (recovering) return <Navigate to="/reset-password" replace />;
  if (mfaNeeded === undefined) return <div className="full-center"><Spinner /></div>;
  if (mfaNeeded) return <MfaChallengePage />;
  return <Outlet />;
}

function RequireVendor() {
  const { session, profile, profileLoading, recovering, plan, planLoading, mfaNeeded } = useAuth();
  const location = useLocation();
  if (session === undefined) return <div className="full-center"><Spinner /></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (recovering) return <Navigate to="/reset-password" replace />;
  if (mfaNeeded === undefined) return <div className="full-center"><Spinner /></div>;
  if (mfaNeeded) return <MfaChallengePage />;
  if ((profileLoading && !profile) || (planLoading && plan === undefined)) return <div className="full-center"><Spinner /></div>;
  // No live plan (a new account, or a trial/subscription that ended) →
  // the plan picker. Accounts from before plans are 'legacy' Starter.
  // plan === undefined means it couldn't be read — never block on that.
  if (plan !== undefined && effectiveTier(plan) === 'none') return <Navigate to="/plan" replace />;
  if (!profile || !profile.business_name?.trim()) return <SetupPage />;
  return <TimerProvider><AppShell><Outlet /></AppShell></TimerProvider>;
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route element={<RequireSession />}>
              <Route path="/plan" element={<PlanPage />} />
              <Route path="/plan/trial" element={<TrialPage />} />
              <Route path="/welcome" element={<WelcomePage />} />
            </Route>
            <Route element={<RequireVendor />}>
              <Route index element={<DashboardPage />} />
              <Route path="storefront" element={<StorefrontPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/new" element={<OrderEditorPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="orders/:id/edit" element={<OrderEditorPage />} />
              <Route path="menu" element={<MenuPage />} />
              <Route path="menu/new" element={<MenuItemEditorPage />} />
              <Route path="menu/:id" element={<MenuItemEditorPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="customers/:id" element={<CustomerProfilePage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="schedule" element={<SchedulePage />} />
              <Route path="recipes" element={<RecipesPage />} />
              <Route path="recipes/new" element={<RecipeEditorPage />} />
              <Route path="recipes/:id" element={<RecipeDetailPage />} />
              <Route path="recipes/:id/edit" element={<RecipeEditorPage />} />
              <Route path="forms" element={<FormsPage />} />
              <Route path="forms/new" element={<FormBuilderPage />} />
              <Route path="forms/:id" element={<FormBuilderPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="payouts" element={<PayoutsPage />} />
              <Route path="shop-settings" element={<ShopSettingsPage />} />
              <Route path="refer" element={<ReferPage />} />
              <Route path="security" element={<TwoFactorPage />} />
              <Route path="finances" element={<FinancesPage />} />
              <Route path="promotions" element={<PromotionsPage />} />
              <Route path="ingredients" element={<IngredientsPage />} />
              <Route path="packaging" element={<PackagingPage />} />
              <Route path="calculator" element={<CalculatorPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
