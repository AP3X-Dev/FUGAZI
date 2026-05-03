from .views import home, about


urlpatterns = [
    ("", home),
    ("about/", about),
]
