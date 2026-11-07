# Deploy

Before you deploy the service to production you must confirm that every migration has run on the staging database and that the release owner has approved the change in the tracker.

The deploy job builds the image, pushes the image to the registry, waits for the health check of the new pods, and then removes the old pods from the load balancer one at a time.

Roll back with one command.

If the health check fails for longer than the timeout that the team agreed for the service, the job stops the rollout and posts the failing pod logs to the release channel.
