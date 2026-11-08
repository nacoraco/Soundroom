import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";

import { ApiError } from "../api";
import { useAuth, useLogin } from "../auth";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { data } = useAuth();
  const loginMutation = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: string } | null)?.from ?? "/library";

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  });

  if (data?.user) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = handleSubmit((values) => {
    loginMutation.mutate(values, {
      onSuccess: () => navigate(from, { replace: true }),
    });
  });

  const error = loginMutation.error;
  const errorMessage =
    error instanceof ApiError
      ? error.status === 403
        ? error.message
        : "Invalid email or password."
      : loginMutation.isError
        ? "Unable to sign in. Try again."
        : null;

  return (
    <div className="login-page">
      <section className="login-stage">
        <div className="stage-top">
          <span className="eyebrow">Soundroom / listening archive</span>
          <span>EST. 2026 — LJ</span>
        </div>

        <div className="stage-copy">
          <h1>Soundroom</h1>
          <p>Your records, kept in one quiet room.</p>
        </div>

        <div className="record-scene" aria-hidden="true">
          <div className="record-sleeve">
            <span>SR–001</span>
            <span>Personal archive</span>
            <span>33⅓ RPM</span>
          </div>
          <div className="record">
            <div className="record-label">
              <span>SR</span>
              <small>33⅓</small>
            </div>
          </div>
        </div>

        <div className="stage-bottom">
          <span>01 / Access</span>
          <span>Private archive</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-form-wrap">
          <span className="eyebrow">Members entrance</span>
          <h2>Sign in</h2>
          <p className="login-lede">
            Use the account your administrator created for you.
          </p>

          <form className="login-form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
              {errors.email && (
                <span className="field-error">{errors.email.message}</span>
              )}
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
              />
              {errors.password && (
                <span className="field-error">{errors.password.message}</span>
              )}
            </label>

            {errorMessage && (
              <div className="form-error" role="alert">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="login-note">
            No public registration. Accounts are issued by the archive
            administrator.
          </p>
        </div>
      </section>
    </div>
  );
}
