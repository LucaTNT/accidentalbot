'use strict';

var sugar = require('sugar');
var irc = require('irc');
var webSocket = require('ws');

var channel = '#atp';
var webAddress = 'http://www.caseyliss.com/showbot';
var TITLE_LIMIT = 75;
var BOT_LANG = 'en';

var user_string = require('./lang/' + BOT_LANG + '.json');

var titles = [];
var connections = [];
var links = [];

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

function handleNewSuggestion(from, message) {
    var title = '';
    if (message.match(/^!s(?:uggest)?\s+(.+)/)) {
        title = RegExp.$1.compact();
    }

    if (title.length > TITLE_LIMIT) {
        client.say(from, user_string['titletoolong'] + TITLE_LIMIT +
            user_string['characterstryagain']);
        title = '';
    }
    if (title.length > 0) {

		var normalizedTitle = normalize(title);

        // Make sure this isn't a duplicate.
        if (titles.findAll({normalized: normalizedTitle}).length === 0) {
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
            client.say(from, user_string['duplicatetitle']);
        }
    }
}

function normalize(title) {
	// Strip trailing periods from title
	title = title.toLowerCase();
	title = title.replace(/^[.\s]+|[.\s]+$/g, '');

	return title;
}

function handleSendVotes(from, message) {
    var titlesByVote = titles.sortBy(function (t) {
        return t.votes;
    }, true).to(3);

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

var client = new irc.Client('irc.freenode.net', 'accidentalbot', {
    channels: [channel]
});

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
    if (message.startsWith('!s')) {
        handleNewSuggestion(from, message);
    } else if (message.startsWith("!votes")) {
        handleSendVotes(from, message);
    } else if (message.startsWith('!l')) {
        handleNewLink(from, message);
    } else if (message.startsWith('!help')) {
        handleHelp(from);
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

    var address = getRequestAddress(socket.upgradeReq);

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
            if (getRequestAddress(connections[i].upgradeReq) === address &&
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

function getRequestAddress(request) {
    if (proxied && 'x-forwarded-for' in request.headers) {
        // This assumes that the X-Forwarded-For header is generated by a
        // trusted proxy such as Heroku. If not, a malicious user could take
        // advantage of this logic and use it to to spoof their IP.
        var forwardedForAddresses = request.headers['x-forwarded-for'].split(',');
        return forwardedForAddresses[forwardedForAddresses.length - 1].trim();
    } else {
        // This is valid for direct deployments, without routing/load balancing.
        return request.connection.remoteAddress;
    }
}

socketServer.on('connection', function(socket) {
    if (floodedBy(socket)) return;

    connections.push(socket);
    var address = getRequestAddress(socket.upgradeReq);
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

        if (flags.binary) {
            console.log("ignoring binary message from "  + address);
            return;
        }

        var packet;
        try {
            packet = JSON.parse(data);
        } catch (e) {
            console.log('error: malformed JSON message (' + e + '): '+ data);
            return;
        }

        if (packet.operation === 'VOTE') {
            var matches = titles.findAll({id: packet['id']});

            if (matches.length > 0) {
                var upvoted = matches[0];
                if (upvoted['votesBy'].any(address) === false) {
                    upvoted['votes'] = Number(upvoted['votes']) + 1;
                    upvoted['votesBy'].push(address);
                    console.log('+1 for ' + upvoted['title'] + ' by ' + address);

                    // Cycle through all the open sockets and send everyone a new list, containing the new vote counts
                    connections.forEach(function (connection) {
                        // Get the current socket's address
                        var thisAddress = getRequestAddress(connection.upgradeReq);
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
                } else {
                    console.log('ignoring duplicate vote by ' + address + ' for ' + upvoted['title']);
                }
            } else {
                console.log('no matches for id: ' + packet['id']);
            }
        } else if (packet.operation === 'PING') {
            socket.send(JSON.stringify({operation: 'PONG'}));
        } else {
            console.log("Don't know what to do with " + packet['operation']);
        }
    });
});
