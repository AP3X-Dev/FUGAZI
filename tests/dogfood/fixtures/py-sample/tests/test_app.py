from src.app import create_app, seed_user


def test_create_app_returns_flask():
    app = create_app()
    assert app is not None


def test_seed_user_returns_user():
    u = seed_user()
    assert u.id == 1
