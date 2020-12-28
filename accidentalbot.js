'use strict';

var sugar = require('sugar');
var irc = require('irc-upd');
var webSocket = require('ws');

// Configuration of the """REST""" API server
// Token to "secure" reset commands
let resetToken = process.env.resetToken || '1234567890';
let http_port = process.env.HTTP_PORT || 9999;
let http_host = process.env.HTTP_HOST || '127.0.0.1';

// IRC bot config
var channel = process.env.IRC_CHANNEL || '#EasyPodcast';
var webAddress = process.env.VOTE_URL || 'https://live.easypodcast.it/titoli/';

var TITLE_LIMIT = 75;
var BOT_LANG = process.env.BOT_LANG || 'it';

var user_string = require('./lang/' + BOT_LANG + '.json');

let MAIL_CRON_ENABLE = (typeof process.env.MAIL_CRON_ENABLE !== "undefined")
let MAIL_CRON_HOUR = process.env.MAIL_CRON_HOUR || 23
let MAIL_CRON_MINUTE = process.env.MAIL_CRON_MINUTE || 59

// Local HTTP server to get the data
var http = require('http');
var server = http.createServer(function (req, res) {
    var pieces = req.url.split('/');
    var notFound = true;
    if (pieces.length > 2)
    {
        if (pieces[1] == 'v1')
        {
            if (pieces[2] == 'ping')
            {
                res.writeHead(200, {'Content-Type': 'text/plain'});
                res.end('pong');
                notFound = false;
            }


            if (pieces[2] == 'titles')
            {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify(titles));
                notFound = false;
            }

            if (pieces[2] == 'links')
            {
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify(links));
                notFound = false;
            }

            if (pieces[2] == 'resetAll' && pieces.length > 3 && pieces[3] == resetToken)
            {
                titles = [];
                mostVoted = {id: -1, votes: 0}
                links = [];
                refreshEveryone();
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({operation: 'resetAll', result: 'success'}));
                notFound = false;
            }

            if (pieces[2] == 'resetLinks' && pieces.length > 3 && pieces[3] == resetToken)
            {
                links = [];
                refreshEveryone();
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({operation: 'resetAll', result: 'success'}));
                notFound = false;
            }

            if (pieces[2] == 'resetTitles' && pieces.length > 3 && pieces[3] == resetToken)
            {
                titles = [];
                mostVoted = {id: -1, votes: 0}
                refreshEveryone();
                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({operation: 'resetAll', result: 'success'}));
                notFound = false;
            }
        }
    }

    if (notFound === true)
    {
        res.writeHead(400);
        res.end(JSON.stringify({error: true, message: 'Unknown request'}));
    }
})

function refreshEveryone()
{
    connections.forEach(function (connection) {
        // Get the current socket's address
        var thisAddress = getRequestAddress(connection);
        // Prepare a custom list for that address
        var titlesWithVotes = titles.map(function (title) {
            var isVoted = title.votesBy.some(function (testAddress) {
                return testAddress === thisAddress;
            });
            var newTitle = {
                id: title.id,
                author: title.author,
                title: title.title,
                votes: title.votes,
                voted: isVoted,
                time: title.time
            };
            return newTitle;
        });
        // Send to this socket and keep on cycling through
        connection.send(JSON.stringify({operation: 'REFRESH', titles: titlesWithVotes, links: links}));
    });
}

server.listen(http_port, http_host);

var titles = [];
var connections = [];
var links = [];

var mostVoted = {id: -1, votes: 0}; // Empty entry for the most voted at startup

// Mail-summary settings
var nodemailer = require('nodemailer');
var transporter = nodemailer.createTransport({
    sendmail: true,
    newline: 'unix',
    path: '/usr/sbin/sendmail'
});
var mailSender = 'easybot@easypodcast.it';
var mailTo = 'info@easypodcast.it';
var schedule = require('node-schedule');
// Mail-summary schedule
if (MAIL_CRON_ENABLE) {
    var j = schedule.scheduleJob({hour: MAIL_CRON_HOUR, minute: MAIL_CRON_MINUTE}, sendSummary);
}


function sendToAll(packet) {
    connections.forEach(function (connection) {
        try {
            connection.send(JSON.stringify(packet));
        } catch (e) {
            console.log('sendToAll error: ' + e);
        }
    });
}

setInterval(saveBackup, 300000);

function saveBackup() {
    // TODO: Figure out what to do here.
}

function sendSummary() {
    // Don't bother sending an email if there's nothing to send
    if (titles.length + links.length > 0) {
        if (titles.length > 0) {
            var html = "<h1>" + user_string['titles'] + "</h1>\n<ul>";
            titles.forEach(
                function (title) {
                    html += "\n<li>" + title.title + ' - ' + user_string['suggestedby'] + ' ' + title.author + ' - ' + title.votes + ' ' + (title.votes != 1 ? user_string['votes'] : user_string['vote']) + '</li>';
                }
            )
            html += "\n</ul>"
        }

        if (links.length > 0) {
            html += "\n<h1>" + user_string['links'] + "</h1>\n<ul>";
            var markdown = '';
            links.forEach(
                function (link) {
                    html += "\n<li><a href=\"" + link.link + '">' + link.link + '</a></li>';
                    markdown += "\n* [" + link.link + "](" + link.link + ")";
                }
            )
            html += "\n</ul><br /><pre style=\"background-color: #eee;\">" + markdown + "</pre>";
        }
        
        transporter.sendMail({
            from: mailSender,
            to: mailTo,
            subject: user_string['botsummary'],
            html: html
        });
    }
}

function handleNewSuggestion(from, message, fromSocket) {
    fromSocket = fromSocket || false;
    var title = '';

    let suggestionRegex = /^!s(?:uggest)?\s+(.+)/
    let match = suggestionRegex.exec(message)
    if (match) {
        title = match[1];
    }

    if (title.length > TITLE_LIMIT) 
    {
        var tooLongMessage = user_string['titletoolong'] + TITLE_LIMIT + user_string['characterstryagain'];
        if (fromSocket)
        {
            fromSocket.send(JSON.stringify({operation: "ALERT", alert: tooLongMessage}));
        }
        else
        {
            client.say(from, tooLongMessage);
        }
        title = '';
    }
    if (title.length > 0) {

		var normalizedTitle = normalize(title);

        // Make sure this isn't a duplicate.
        if (titles.filter(function(element){ return element.normalized == normalizedTitle}).length === 0) {
            title = {
                id: titles.length,
                author: from,
                title: title,
                normalized: normalizedTitle,
                votes: 0,
                votesBy: [],
                time: new Date()
            };
            titles.push(title);

            sendToAll({operation: 'NEW', title: title});
        } else {

            //client.say(channel, 'Sorry, ' + from + ', your title is a duplicate. Please try another!');
            if (fromSocket)
            {
                fromSocket.send(JSON.stringify({operation: "ALERT", alert: user_string['duplicatetitle']}));
            }
            else
            {
                client.say(from, user_string['duplicatetitle']);
            }
        }
    }
}

function normalize(title) {
	// Strip trailing periods from title
	title = title.toLowerCase();
	title = title.replace(/[^a-zA-Z0-9]+/g, '');

	return title;
}

function sortTitles(a, b) {
    if (a.votes < b.votes) {
        return 1;
    }
    if (a.votes == b.votes) {
        return 0;
    }
    if (a.votes > b.votes) {
        return -1;
    }
}

function handleSendVotes(from, message) {
    var titlesByVote = titles.sort(sortTitles).slice(0, 3);

    client.say(from, user_string['threemostpopular']);
    for (var i = 0; i < titlesByVote.length; ++i) {
        var votes = titlesByVote[i]['votes'];
        client.say(from, titlesByVote[i]['votes'] + ' ' + (votes != 1 ? user_string['votes'] : user_string['vote']) +  ': "' + titlesByVote[i].title + '"');
    }
}

function handleNewLink(from, message) {
    if (message.startsWith('!link')) {
        message = message.substring(6);
    } else if (message.startsWith('!l')) {
        message = message.substring(3);
    }

    if (message.startsWith('http')) {
        var link = {
            id: links.length,
            author: from,
            link: message,
            time: new Date()
        };
        links.push(link);

        sendToAll({operation: 'NEWLINK', link: link});
    } else {
        client.say(from, user_string['notalink']);
    }
}

function handleHelp(from) {
    client.say(from, user_string['options']);
    client.say(from, user_string['helpsuggest']);
    client.say(from, user_string['helpvotes']);
    client.say(from, user_string['helplink']);
    client.say(from, user_string['helphelp']);
    client.say(from, user_string['helpviewtitles'] + webAddress);
}

function handleNewVote(upvoted)
{
    var newMostVoted = titles.sort(sortTitles).slice(0, 1)[0];

    // If this vote makes this title the most voted one, act:
    // (don't bother for ties)
    if(newMostVoted['id'] != mostVoted['id'] && newMostVoted['votes'] > mostVoted['votes'])
    {
        mostVoted = newMostVoted;
        client.say(channel, 'Ora il titolo più votato è "' + mostVoted['title'] + '" con ' + Number(mostVoted['votes']) + ' voti');
        handleSendVotes(channel, '');
    }
}

var options = {
    channels: [channel],
    showErrors: false,
    userName: 'easybot',
    realName: 'EasyPodcast IRC Robot'
}
if (typeof process.env.PASSWORD !== "undefined") {
    options.sasl = true;
    options.password = process.env.PASSWORD;
}

var client = new irc.Client('irc.freenode.net', 'easybot', options);


client.addListener('join', function (channel, nick, message) {
    if (nick === client.nick) {
        console.log("Joined channel " + channel + ".");
    } else {
        client.say(nick, user_string['greeting']);
    }
});

client.addListener('connect', function() {
    console.log("Connected to IRC.");
});

client.addListener('kick', function (channel, nick, by, reason) {
    if (nick === client.nick) {
        console.log("Kicked from channel " + channel + " by " + by + " because " + reason + ".");
    }
});

client.addListener('message', function (from, to, message) {
    if (message.startsWith("!votes")) {
        handleSendVotes(from, message);
    } else if (message.startsWith('!l')) {
        handleNewLink(from, message);
    } else if (message.startsWith('!help')) {
        handleHelp(from);
    } else if (message.startsWith('mail')) {
        sendSummary()
    }
});

client.addListener('message#', function (from, to, message) {
   if (message.startsWith("!s ")) {
       handleNewSuggestion(from, message);
   } 
});

client.addListener('pm', function (from, message) {
   if (message.startsWith('!s')) {
        client.say(from, "I'm sorry, suggestions can only be made in " + channel + ".");
   } 
});

client.addListener('error', function (message) {
    console.log('error: ', message);
});

/***************************************************
 * WEB SOCKETS                                     *
 ***************************************************/

var port = Number(process.env.PORT || 5001);
var proxied = process.env.PROXIED === 'true';
var socketServer = new webSocket.Server({port: port});

// DOS protection - we disconnect any address which sends more than windowLimit
// messages in a window of windowSize milliseconds.
var windowLimit = 50;
var windowSize = 5000;
var currentWindow = 0;
var recentMessages = {};
function floodedBy(socket) {
    // To be called each time we get a message or connection attempt.
    //
    // If that address has been flooding us, we disconnect all open connections
    // from that address and return `true` to indicate that it should be
    // ignored. (They will not be prevented from re-connecting after waiting
    // for the next window.)
    if (socket.readyState == socket.CLOSED) {
        return true;
    }

    var address = getRequestAddress(socket);

    var updatedWindow = 0 | ((new Date) / windowSize);
    if (currentWindow !== updatedWindow) {
        currentWindow = updatedWindow;
        recentMessages = {};
    }

    if (address in recentMessages) {
        recentMessages[address]++;
    } else {
        recentMessages[address] = 1;
    }

    if (recentMessages[address] > windowLimit) {
        console.warn("Disconnecting flooding address: " + address);
        socket.terminate();

        for (var i = 0, l = connections.length; i < l; i++) {
            if (getRequestAddress(connections[i]) === address &&
                connections[i] != socket) {
                console.log("Disconnecting additional connection.");
                connections[i].terminate();
            }
        }

        return true;
    } else {
        return false;
    }
}
// CHECK THIS https://stackoverflow.com/posts/18553850/revisions
function getRequestAddress(request) {
    if (proxied && 'x-forwarded-for' in request.headers) {
        // This assumes that the X-Forwarded-For header is generated by a
        // trusted proxy such as Heroku. If not, a malicious user could take
        // advantage of this logic and use it to to spoof their IP.
        var forwardedForAddresses = request.headers['x-forwarded-for'].split(',');
        return forwardedForAddresses[forwardedForAddresses.length - 1].trim();
    } else {
        // This is valid for direct deployments, without routing/load balancing.
        return request._socket.remoteAddress;
    }
}

socketServer.on('connection', function(socket) {
    if (floodedBy(socket)) return;

    connections.push(socket);
    var address = getRequestAddress(socket);
    console.log('Client connected: ' + address);

    // Instead of sending all of the information about current titles to the
    // newly-connecting user, which would include the IP addresses of other
    // users, we just send down the information they need.
    var titlesWithVotes = titles.map(function (title) {
        var isVoted = title.votesBy.some(function (testAddress) {
            return testAddress === address;
        });
        var newTitle = {
            id: title.id,
            author: title.author,
            title: title.title,
            votes: title.votes,
            voted: isVoted,
            time: title.time
        };
        return newTitle;
    });
    socket.send(JSON.stringify({operation: 'REFRESH', titles: titlesWithVotes, links: links}));

    socket.on('close', function () {
        console.log('Client disconnected: ' + address);
        connections.splice(connections.indexOf(socket), 1);
    });

    socket.on('error', function (reason, code) {
      console.log('socket error: reason ' + reason + ', code ' + code);
    });

    socket.on('message', function (data, flags) {
        if (floodedBy(socket)) return;

        var packet;
        try {
            packet = JSON.parse(data);
        } catch (e) {
            console.log('error: malformed JSON message (' + e + '): '+ data);
            return;
        }

        if (packet.operation === 'VOTE') {
            var matches = titles.filter(function(title) { return title.id == packet['id']});

            if (matches.length > 0) {
                var upvoted = matches[0];
                if (upvoted['votesBy'].find(function (vote) { return vote == address }) === undefined) {
                    upvoted['votes'] = Number(upvoted['votes']) + 1;
                    upvoted['votesBy'].push(address);
                    console.log('+1 for ' + upvoted['title'] + ' by ' + address);

                    // Cycle through all the open sockets and send everyone a new list, containing the new vote counts
                    connections.forEach(function (connection) {
                        // Get the current socket's address
                        var thisAddress = getRequestAddress(connection);
                        // Prepare a custom list for that address
                        var titlesWithVotes = titles.map(function (title) {
                            var isVoted = title.votesBy.some(function (testAddress) {
                                return testAddress === thisAddress;
                            });
                            var newTitle = {
                                id: title.id,
                                author: title.author,
                                title: title.title,
                                votes: title.votes,
                                voted: isVoted,
                                time: title.time
                            };
                            return newTitle;
                        });
                        // Send to this socket and keep on cycling through
                        connection.send(JSON.stringify({operation: 'REFRESH', titles: titlesWithVotes, links: links}));
                    });
                    handleNewVote(upvoted);
                } else {
                    console.log('ignoring duplicate vote by ' + address + ' for ' + upvoted['title']);
                }
            } else {
                console.log('no matches for id: ' + packet['id']);
            }
        } else if (packet.operation === 'PING') {
            socket.send(JSON.stringify({operation: 'PONG'}));
        } else if (packet.operation == 'NEW') {
            handleNewSuggestion(packet['author'], '!s ' + packet['title'], socket);
        } else {
            console.log("Don't know what to do with " + packet['operation']);
        }
    });
});
