def test_smoke(sample_data):
    assert sample_data["x"] == 1


def test_db(db_conn):
    assert db_conn == "conn"
