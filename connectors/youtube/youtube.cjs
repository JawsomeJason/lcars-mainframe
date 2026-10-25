'use strict';
// Subscriber count from the official YouTube Data API v3.
// Needs YOUTUBE_API_KEY (a Google Cloud API key with YouTube Data API enabled)
// and YOUTUBE_CHANNEL_ID (starts with "UC"). Prints {"youtube_subscribers": N}.
async function collect(){
 const key=process.env.YOUTUBE_API_KEY,channel=process.env.YOUTUBE_CHANNEL_ID;
 const url='https://www.googleapis.com/youtube/v3/channels?part=statistics&id='+encodeURIComponent(channel)+'&key='+encodeURIComponent(key);
 const response=await fetch(url);
 if(!response.ok)throw Error('YouTube API answered '+response.status+'.');
 const item=(await response.json()).items?.[0];
 if(!item)throw Error('No channel found for YOUTUBE_CHANNEL_ID.');
 if(item.statistics.hiddenSubscriberCount)throw Error('The channel hides its subscriber count.');
 return Number(item.statistics.subscriberCount);
}
collect().then(n=>console.log(JSON.stringify({youtube_subscribers:n})),e=>{console.error(e.message);process.exit(1);});
