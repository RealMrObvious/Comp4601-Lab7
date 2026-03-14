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
        score = predict(user_index, item_index, data).toFixed(2)
        source = 'guess'
    } else {
        source = 'truth'
    }

    res.json({
        "score": score,
        "source": source
    });
});

function calculateSimilarities(user_a_index, user_b_index, dataset) {
    let num_items = dataset.num_items;
    let matrix = dataset.matrix;
    let user_a_avg_rating = dataset.avgRating[user_a_index]
    let user_b_avg_rating = dataset.avgRating[user_b_index]

    let numerator = 0;
    let denominator_a = 0;
    let denominator_b = 0;

    for (let i = 0; i < num_items; i++) {
        user_a_rating = matrix.get([user_a_index, i])
        user_b_rating = matrix.get([user_b_index, i])

        //Numerator
        if (user_a_rating != -1 && user_b_rating != -1) {
            numerator += (user_a_rating - user_a_avg_rating) * (user_b_rating - user_b_avg_rating)

            //Denominator
            denominator_a += Math.pow((user_a_rating - user_a_avg_rating), 2)
            denominator_b += Math.pow((user_b_rating - user_b_avg_rating), 2)
        }
    }

    let denominator = Math.sqrt(denominator_a) * Math.sqrt(denominator_b)
    let score = numerator / denominator

    // console.log("Final score: ", numerator, denominator, score)
    return score

}


//Returns a matrix with the similarity scores between each neighbour
function calculateNeighbourMatrix(dataset) {
    let num_users = dataset.num_users;
    let neighbour_matrix = math.zeros(num_users, num_users)

    for (let a = 0; a < num_users; a++) {
        for (let b = 0; b < num_users; b++) {
            if (a == b) { continue; }

            let similarity = calculateSimilarities(a, b, dataset)
            neighbour_matrix.set([a, b], similarity)
        }
    }

    // console.log(neighbour_matrix)
    return neighbour_matrix
}

function getNeighbourhood(user_index, matrix, neighborhood_size = 2) {
    // Extract the col as a regular array
    const col = matrix.subset(math.index(math.range(0, matrix.size()[0]), user_index)).toArray();

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

function predict(user_index, item_index, dataset) {
    let score = 0
    let base_matrix = dataset.matrix
    let avg_rating = getAvgRating(user_index, base_matrix)
    let neighbour_matrix = calculateNeighbourMatrix(dataset)
    let neighbours = getNeighbourhood(user_index, neighbour_matrix)

    
    let numerator = 0
    let denominator = 0
    for (let n of neighbours) {
        //Numerator
        let sim_score = neighbour_matrix.get([user_index, n])
        let n_rating = base_matrix.get([n, item_index])

        if (n_rating == -1) {
            continue
        } else {
            n_rating = n_rating - getAvgRating(n, base_matrix)
        }

        numerator += (sim_score * n_rating)

        //Denominator
        sim_score = neighbour_matrix.get([user_index, n])
        denominator += sim_score
    }

    if (denominator === 0) return avg_rating;
    score = numerator / denominator

    return avg_rating + score
}


function getAvgRating(rowIndex, matrix) {
    // Extract the row as a regular array
    const row = matrix.subset(
        math.index(rowIndex, math.range(0, matrix.size()[1]))
    ).toArray();

    let sum = 0
    let num_ratings = 0

    //Sum all values != -1
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
        data.avgRating.push(getAvgRating(i, data.matrix))
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