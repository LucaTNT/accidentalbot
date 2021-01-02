#!/usr/bin/env bash
image="cr.casa.lucazorzi.net/easypodcast/showbot"

if [ $# -eq 0 ]
  then
    tag='latest'
  else
    tag=$1
fi

docker build -t $image:$tag .

echo "Push $image:$tag? [y/N]"
read push_image

if [[ "$push_image" == "y" ]]
  then
    docker push $image:$tag
fi