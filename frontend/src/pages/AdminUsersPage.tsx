import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ApiError, createUser, listUsers, updateUser } from "../api";
import { useAuth } from "../auth";
import type { User, UserCreateInput, UserUpdateInput } from "../types";

const createSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  display_name: z.string().min(1, "Display name is required."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.enum(["listener", "editor"]),
});

type CreateValues = z.infer<typeof createSchema>;

const USERS_KEY = ["admin-users"] as const;

export function AdminUsersPage() {
  const { data: auth } = useAuth();
  const currentUser = auth?.user;
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: USERS_KEY,
    queryFn: listUsers,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: "listener" },
  });

  const createMutation = useMutation({
    mutationFn: (input: UserCreateInput) => createUser(input),
    onSuccess: () => {
      reset({ email: "", display_name: "", password: "", role: "listener" });
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UserUpdateInput;
    }) => updateUser(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
  });

  const onSubmit = handleSubmit((values) => {
    createMutation.mutate(values);
  });

  function toggleUser(user: User) {
    if (user.is_active) {
      const confirmed = window.confirm(
        `Deactivate ${user.email}? Their sessions will be revoked.`,
      );
      if (!confirmed) {
        return;
      }
    }
    updateMutation.mutate({
      id: user.id,
      input: { is_active: !user.is_active },
    });
  }

  const mutationError = createMutation.error ?? updateMutation.error;

  return (
    <section className="page">
      <header className="page-header">
        <div className="page-title">
          <span className="eyebrow">Administration / People</span>
          <h1>People &amp; access</h1>
        </div>
        <div className="page-aside">
          <span className="eyebrow">Directory</span>
          <span>
            {usersQuery.data?.length ?? 0}{" "}
            {usersQuery.data?.length === 1 ? "account" : "accounts"}
          </span>
        </div>
      </header>

      {mutationError && (
        <div className="form-error" role="alert">
          {mutationError instanceof ApiError
            ? mutationError.message
            : "The request could not be completed."}
        </div>
      )}

      <div className="admin-layout">
        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">New accession</span>
            <h2>Create an account</h2>
          </div>

          <form className="user-form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="off"
                aria-invalid={Boolean(errors.email)}
                {...register("email")}
              />
              {errors.email && (
                <span className="field-error">{errors.email.message}</span>
              )}
            </label>

            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                autoComplete="off"
                aria-invalid={Boolean(errors.display_name)}
                {...register("display_name")}
              />
              {errors.display_name && (
                <span className="field-error">
                  {errors.display_name.message}
                </span>
              )}
            </label>

            <label className="field">
              <span>Temporary password</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                {...register("password")}
              />
              {errors.password && (
                <span className="field-error">{errors.password.message}</span>
              )}
            </label>

            <label className="field">
              <span>Role</span>
              <select {...register("role")}>
                <option value="listener">Listener</option>
                <option value="editor">Editor</option>
              </select>
            </label>

            <button
              type="submit"
              className="button button-primary button-block"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : "Create account"}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span className="eyebrow">Directory</span>
            <h2>Accounts</h2>
          </div>

          {usersQuery.isLoading && <p className="muted">Loading accounts…</p>}
          {usersQuery.isError && (
            <p className="form-error" role="alert">
              Accounts could not be loaded.
            </p>
          )}

          {usersQuery.data && usersQuery.data.length === 0 && (
            <p className="muted">No accounts yet.</p>
          )}

          {usersQuery.data && usersQuery.data.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {usersQuery.data.map((user) => (
                    <tr key={user.id}>
                      <td data-label="Email">{user.email}</td>
                      <td data-label="Name">{user.display_name}</td>
                      <td data-label="Role">
                        <select
                          className="table-select"
                          aria-label={`Role for ${user.email}`}
                          value={user.role}
                          disabled={
                            user.role === "admin" ||
                            user.id === currentUser?.id ||
                            updateMutation.isPending
                          }
                          onChange={(event) =>
                            updateMutation.mutate({
                              id: user.id,
                              input: {
                                role: event.target.value as
                                  | "listener"
                                  | "editor",
                              },
                            })
                          }
                        >
                          {user.role === "admin" && (
                            <option value="admin">Admin</option>
                          )}
                          <option value="listener">Listener</option>
                          <option value="editor">Editor</option>
                        </select>
                      </td>
                      <td data-label="Status">
                        <span
                          className={`status ${
                            user.is_active
                              ? "status-active"
                              : "status-disabled"
                          }`}
                        >
                          {user.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td data-label="Actions">
                        {user.role !== "admin" &&
                          user.id !== currentUser?.id && (
                            <button
                              type="button"
                              className="button button-quiet"
                              onClick={() => toggleUser(user)}
                              disabled={updateMutation.isPending}
                            >
                              {user.is_active ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
