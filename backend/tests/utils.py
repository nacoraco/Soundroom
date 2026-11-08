ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password"


def login(client, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )


def auth_headers(csrf_token: str) -> dict[str, str]:
    return {"X-CSRF-Token": csrf_token}
