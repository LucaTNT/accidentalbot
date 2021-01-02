#!/usr/bin/env bash
pushd webclient
image="cr.casa.lucazorzi.net/easypodcast/showbot_web"

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