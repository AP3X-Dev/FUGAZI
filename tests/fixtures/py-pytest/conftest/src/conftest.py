import pytest


@pytest.fixture
def sample_data():
    return {"x": 1, "y": 2}


@pytest.fixture
def db_conn():
    return "conn"
