import asyncio

from .worker import work


async def run():
    return await work()


def main():
    return asyncio.run(run())


if __name__ == "__main__":
    main()
