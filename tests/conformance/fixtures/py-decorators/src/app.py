from flask import Flask

app = Flask(__name__)


@app.route("/")
def home():
    return "home"


@app.route("/users")
def users():
    return "users"


def unused_helper():
    return "unused"
