routes = "route-table-stub"


@routes.get("/")
async def index(request):
    return "index"


@routes.post("/items")
async def create_item(request):
    return "created"
