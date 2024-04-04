import os
def global_context(request):

    glob = {
        "stage": os.environ.get('STAGE', 'dev'),
        "version": os.environ.get('version', 'v1'),
    }


    return {'glob': glob}