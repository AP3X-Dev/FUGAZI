from .urls import urlpatterns
from .settings import DEBUG


def main():
    print(DEBUG, urlpatterns)


if __name__ == "__main__":
    main()
