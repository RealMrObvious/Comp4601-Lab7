//require stuff
const express = require('express');
const app = express();
const path = require('path');
const fs = require("fs");
const math = require('mathjs');

app.use(express.static("public"));
app.use(express.json());
var files = {}
 

//Reccomendations/:test
app.get('/:dataset', async function (req, res) {
    let datasetName = req.params.dataset;
    const { type, user, item } = req.query;

    // console.log("Dataset:", datasetName);
    // console.log("Type:", type);
    // console.log("User:", user);
    // console.log("Item:", item);

    if (!(datasetName in files)) {
        return res.status(400).json({ error: "Dataset not found" });
    }

    if (!type || !user || !item) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    //Get indexes of user and item in their respective arrays, then get the score from the matrix
    let user_index = files[datasetName].userArr.indexOf(user)
    let item_index = files[datasetName].itemArr.indexOf(item)
    let data = files[datasetName]

    let matrix = files[datasetName].matrix
    let score = matrix.get([user_index, item_index])
    let source = ''

    if (score == -1) {
        score = predict(user_index, item_index, data)
        source = 'guess'
    } else {
        source = 'truth'
    }

    res.json({
        "score": score,
        "source": source
    });
});


// This is the function on slide 11 of lecture 8 [sim(a,b)=...]
function calculateSimilarities(item_a_index, item_b_index, dataset) {
    let num_users = dataset.num_users;
    let matrix = dataset.matrix;
    let user_avg = 0;

    let numerator = 0;
    let denominator_a = 0;
    let denominator_b = 0;

    for (let i = 0; i < num_users; i++) {
        let item_a_rating = matrix.get([i, item_a_index])
        let item_b_rating = matrix.get([i, item_b_index])
        user_avg = dataset.avgRating[i]

        //Numerator
        if (item_a_rating != -1 && item_b_rating != -1) {
            numerator += (item_a_rating - user_avg) * (item_b_rating - user_avg)

            //Denominator
            denominator_a += Math.pow(item_a_rating - user_avg, 2)
            denominator_b += Math.pow(item_b_rating - user_avg, 2)
        }
    }

    let denominator = Math.sqrt(denominator_a) * Math.sqrt(denominator_b)
    if (denominator === 0) return 0;
    
    let score = numerator / denominator

    // console.log("Final score: ", numerator, denominator, score)
    return score

}


// Returns a matrix with the similarity scores between each neighbour
// Each row is a neighbourhood. Each score represents sim(x,y)
// Example numbers
//         a     b     c     d
// a      0.00  0.83  0.41  0.65
// b      0.83  0.00  0.38  0.59
// c      0.41  0.38  0.00  0.27
// d      0.65  0.59  0.27  0.00

function calculateNeighbourMatrix(dataset) {
    let num_items = dataset.num_items;
    let neighbour_matrix = math.zeros(num_items, num_items)

    for (let a = 0; a < num_items; a++) {
        for (let b = 0; b < num_items; b++) {
            if (a == b) { continue; }

            let similarity = calculateSimilarities(a, b, dataset)
            neighbour_matrix.set([a, b], similarity)
        }
    }

    // console.log(neighbour_matrix)
    return neighbour_matrix
}

// Takes a row from the neighbourhood matrix (made from calculateNeighbourMatrix()) 
// and returns the top <neighborhood_size> neighbours as an array of indices for each neighbour
//
// ie. row for user a
//         a     b     c     d
// a       0    0.83  0.41  0.65
//
// It then loops through and returns the top scores indices
// so it'd return indices for b & d -> so it returns [1,3]
function getNeighbourhood(item_index, matrix, neighborhood_size = 2) {
    // Extract the col as a regular array
    const col = matrix.subset(math.index(math.range(0, matrix.size()[0]), item_index)).toArray();

    let topIndices = new Array(neighborhood_size).fill(-1); // Array to store indices of top k largest elements
    let topValues = new Array(neighborhood_size).fill(-Infinity); // Array to store the values of top k largest elements

    for (let i = 0; i < col.length; i++) {
        for (let j = 0; j < neighborhood_size; j++) {
            if (col[i] > topValues[j] && col[i] != 0) {
                // Shift down the smaller values
                for (let k = neighborhood_size - 1; k > j; k--) {
                    topValues[k] = topValues[k - 1];
                    topIndices[k] = topIndices[k - 1];
                }
                // Insert the new value in the correct position
                topValues[j] = col[i];
                topIndices[j] = i;
                break;
            }
        }
    }

    // console.log(topIndices);  // Indices of the top 10 largest elements
    // console.log(topValues);   // Values of the top 10 largest elements
    return topIndices
}


// This is the function on slide 15 of lecture 8 [pred(a,p)=...]
function predict(user_index, item_index, dataset) {
    let score = 0
    let base_matrix = dataset.matrix                                     //matrix from text file
    let neighbour_matrix = calculateNeighbourMatrix(dataset)             //matrix with all the sim scores
    let neighbours = getNeighbourhood(item_index, neighbour_matrix)      //top values in a row from ^^ matrix

    let numerator = 0
    let denominator = 0
    for (let n of neighbours) {
        //Numerator

        if (n <= 0) {
            continue;
        }

        let sim_score = neighbour_matrix.get([item_index, n])
        let n_rating = base_matrix.get([user_index, n])

        if (n_rating == -1) {
            continue
        }

        numerator += sim_score * n_rating;
        
        //denominator
        denominator += sim_score
    }

    if (denominator === 0) return getAvgRating(item_index, base_matrix);
    score = numerator / denominator

    return score
}

//returns the average rating for a user/row (aka rowIndex)
function getAvgRating(colIndex, matrix) {
    // Extract the row as a regular array
    const col = matrix.subset(
        math.index(math.range(0, matrix.size()[0]), colIndex)
    ).toArray();

    let sum = 0
    let num_ratings = 0

    //Sum all values != -1
    for (let i = 0; i < col.length; i++) {
        if (col[i] != -1) {
            sum += col[i];
            num_ratings += 1
        }
    }

    if (num_ratings == 0) return 0

    // Compute average
    return sum / num_ratings;
}

function getUserAvgRating(rowIndex, matrix) {
    // Extract the row as a regular array
    const row = matrix.subset(
        math.index(rowIndex, math.range(0, matrix.size()[1]))
    ).toArray();

    let sum = 0
    let num_ratings = 0

    //Sum all values !=
    for (let i = 0; i < row.length; i++) {
        if (row[i] != -1) {
            sum += row[i];
            num_ratings += 1
        }
    }

    if (num_ratings == 0) return 0

    // Compute average
    return sum / num_ratings;
}

function readFiles(filePath) {
    let file_data = fs.readFileSync(filePath, 'utf8').trim().split("\n");

    data = {
        num_users: parseInt(file_data[0].split(/\s+/)[0]),
        num_items: parseInt(file_data[0].split(/\s+/)[1]),
        userArr: file_data[1].trim().split(/\s+/),
        itemArr: file_data[2].trim().split(/\s+/),
        avgRating: [],
        matrix: math.matrix(file_data.slice(3).map(row => row.trim().split(/\s+/).map(Number)))
    };

    for (let i = 0; i < data.num_users; i++) {
        data.avgRating.push(getUserAvgRating(i, data.matrix))
    }

    return data;
}

app.listen(3001, () => {
    for (const file of fs.readdirSync("./test_files")) {
        file_name = file.split(".")[0];
        files[file_name] = readFiles("./test_files/" + file);
    }
    console.log("Online");
    console.log("Datasets loaded:", Object.keys(files));
});