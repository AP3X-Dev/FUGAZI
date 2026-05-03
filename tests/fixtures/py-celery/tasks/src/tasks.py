def shared_task(fn):
    return fn


@shared_task
def send_email(addr):
    return addr


@shared_task
def aggregate(values):
    return sum(values)
